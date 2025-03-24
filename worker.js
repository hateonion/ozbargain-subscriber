async function handleRequest(request, env) {
  const url = new URL(request.url);
  
  if (url.searchParams.get('test') === 'true') {
    const result = await processAndSendDeals(env);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response('OzBargain Deals Tracker - Add ?test=true to test', {
    headers: { 'Content-Type': 'text/plain' }
  });
}

function getHotDealThreshold(env) {
  if (env.HOT_DEAL_THRESHOLD) {
    const threshold = parseInt(env.HOT_DEAL_THRESHOLD, 10);
    if (!isNaN(threshold)) {
      return threshold;
    }
  }
  return 100;
}

async function processAndSendDeals(env) {
  try {
    const deals = await fetchDeals(env);
    const filteredDeals = filterDeals(deals, env);
    
    let previousDealIds = new Set();
    try {
      const storedDeals = await env.DEALS_STORE.get('previous_deal_ids');
      if (storedDeals) {
        previousDealIds = new Set(JSON.parse(storedDeals));
      }
    } catch (error) {
      console.error('Error reading previous deals:', error);
    }
    
    const newDeals = filteredDeals.filter(deal => !previousDealIds.has(deal.id));
    
    try {
      const currentDealIds = filteredDeals.map(deal => deal.id);
      await env.DEALS_STORE.put('previous_deal_ids', JSON.stringify(currentDealIds));
    } catch (error) {
      console.error('Error saving deal IDs:', error);
    }
    
    if (newDeals.length > 0) {
      await sendToTelegram(newDeals, env);
    }
    
    return {
      totalDeals: deals.length,
      filteredDeals: filteredDeals.length,
      newDeals: newDeals.length,
      dealsData: newDeals
    };
  } catch (error) {
    return { error: error.message };
  }
}

function getUrlsToFetch(env) {
  if (env.URLS_TO_FETCH) {
    try {
      return JSON.parse(env.URLS_TO_FETCH);
    } catch (error) {
      console.error('Error parsing URLS_TO_FETCH:', error);
    }
  }
  
  return [
    'https://www.ozbargain.com.au/?page=0',
    'https://www.ozbargain.com.au/?page=1',
    'https://www.ozbargain.com.au/?page=2',
    'https://www.ozbargain.com.au/brand/american-express',
    'https://www.ozbargain.com.au/tag/gift-card'
  ];
}

async function fetchDeals(env) {
  let allDeals = [];
  const urlsToFetch = getUrlsToFetch(env);

  for (const url of urlsToFetch) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`Failed to fetch from ${url}: ${response.status}`);
        continue;
      }
      
      const html = await response.text();
      const pageDeals = parseHTML(html, url);
      allDeals = [...allDeals, ...pageDeals];
    } catch (error) {
      console.error(`Error fetching from ${url}:`, error);
    }
  }
  
  const uniqueDeals = [];
  const seenIds = new Set();
  
  for (const deal of allDeals) {
    if (!seenIds.has(deal.id)) {
      seenIds.add(deal.id);
      uniqueDeals.push(deal);
    }
  }
  
  return uniqueDeals;
}

function parseHTML(html, sourceUrl) {
  const deals = [];
  
  if (sourceUrl.includes('?page=')) {
    const dealRegex = /<a[^>]*?href="\/node\/(\d+)">([^<]+)<\/a>/g;
    let match;
    
    while ((match = dealRegex.exec(html)) !== null) {
      const id = match[1];
      let title = match[2].trim();
      
      if (title.length < 5 || !title.match(/(\$|\boff\b|\bfree\b|\bdiscount\b|\bsave\b|\bdeal\b)/i)) {
        continue;
      }
      
      let votes = 0;
      const voteContext = html.substring(Math.max(0, match.index - 500), match.index);
      const voteMatch = voteContext.match(/(\d+)(?:\s*<\/div>\s*<div[^>]*?>)?$/); 
      if (voteMatch) {
        votes = parseInt(voteMatch[1], 10);
      }
      
      let category = '';
      const afterMatch = html.substring(match.index, match.index + 500);
      const categoryMatch = afterMatch.match(/\[([^\]]+)\]/);
      if (categoryMatch) {
        category = categoryMatch[1].trim();
      }
      
      const isExpired = title.toLowerCase().includes('expired') || 
                        html.substring(match.index - 50, match.index + 50).toLowerCase().includes('expired');
      
      if (isExpired) continue;
      
      title = title.replace(/\s+/g, ' ').trim();
      title = title.replace(/^\s*\[[^\]]+\]/, '').trim();
      
      deals.push({
        id,
        title,
        link: `https://www.ozbargain.com.au/node/${id}`,
        sourceUrl,
        votes: {
          positive: votes,
          negative: 0,
          total: votes
        },
        categories: [category].filter(Boolean),
        isExpired: false
      });
    }
  } 
  else {
    const dealRegex = /<a[^>]*?href="\/node\/(\d+)"[^>]*?>([^<]*?)<\/a>/g;
    let match;
    
    while ((match = dealRegex.exec(html)) !== null) {
      const id = match[1];
      let title = match[2].trim();
      
      if (title.length < 5 || match[0].includes('/user/') || match[0].includes('/comment/')) {
        continue;
      }
      
      if (!match[0].includes('/node/')) {
        continue;
      }
      
      if (sourceUrl.includes('american-express') && !title.toLowerCase().includes('amex') && 
          !title.toLowerCase().includes('american express') && !title.includes('americanexpress.com')) {
        if (!match[0].includes('goto')) {
          title = "American Express Deal: " + title;
        }
      }
      
      if (sourceUrl.includes('gift-card') && 
          !title.toLowerCase().includes('gift card') && 
          !title.toLowerCase().includes('voucher')) {
        if (!match[0].includes('goto')) {
          title = "Gift Card Deal: " + title;
        }
      }
      
      const isExpired = title.toLowerCase().includes('expired') || 
                        html.substring(match.index - 100, match.index + 100).toLowerCase().includes('expired');
      
      if (isExpired) continue;
      
      title = title.replace(/\s+/g, ' ').trim();
      title = title.replace(/\[expired\]/i, '').trim();
      title = title.replace(/^\s*\[[^\]]+\]/, '').trim();
      
      const category = sourceUrl.includes('american-express') ? 'AMEX' : 'Gift Cards';
      
      deals.push({
        id,
        title,
        link: `https://www.ozbargain.com.au/node/${id}`,
        sourceUrl,
        votes: {
          positive: 0,
          negative: 0,
          total: 0
        },
        categories: [category],
        isExpired: false
      });
    }
  }
  
  return deals;
}

function filterDeals(deals, env) {
  const hotDealThreshold = getHotDealThreshold(env);
  
  return deals.filter(deal => {
    if (deal.sourceUrl.includes('?page=')) {
      return deal.votes.total > hotDealThreshold;
    }
    
    return true;
  });
}

async function sendToTelegram(deals, env) {
  if (deals.length === 0) return;
  
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = env.TELEGRAM_CHAT_ID;
  
  if (!telegramBotToken || !telegramChatId) {
    console.error('Missing Telegram configuration. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in environment variables.');
    return;
  }
  
  let message = '🔥 *New OzBargain Deals* 🔥\n\n';
  
  for (const deal of deals) {
    let emoji = '💰';
    if (deal.sourceUrl.includes('american-express')) {
      emoji = '💳';
    } else if (deal.sourceUrl.includes('gift-card')) {
      emoji = '🎁';
    }
    
    const voteInfo = deal.votes.total > 0 ? `+${deal.votes.total} votes` : '';
    message += `${emoji} *${deal.title}*\n`;
    message += `[Link](${deal.link})${voteInfo ? ` | 👍 ${voteInfo}` : ''}\n\n`;
  }
  
  const telegramUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
  
  const response = await fetch(telegramUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: telegramChatId,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: false
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram API error: ${error}`);
  }
  
  return true;
}

export default {
  async scheduled(controller, env, ctx) {
    return processAndSendDeals(env);
  },
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  }
};