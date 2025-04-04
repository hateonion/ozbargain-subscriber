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
      // Add current deals to the previously seen deals for future checks
      // Instead of replacing the list entirely, preserve history
      const combinedDealIds = [...previousDealIds, ...filteredDeals.map(deal => deal.id)];
      
      // Keep only the most recent 1000 deals to avoid excessive storage
      const recentDealIds = [...new Set(combinedDealIds)].slice(-1000);
      
      await env.DEALS_STORE.put('previous_deal_ids', JSON.stringify(recentDealIds));
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
    // First, try to find all deal nodes
    const nodeMatches = html.match(/data-nid="(\d+)"/g) || [];
    
    for (const nodeMatch of nodeMatches) {
      const idMatch = nodeMatch.match(/data-nid="(\d+)"/);
      if (!idMatch) continue;
      
      const id = idMatch[1];
      const nodeId = `data-nid="${id}"`;
      
      // Find the surrounding vote block by searching for the pattern
      const voteBlockStart = html.indexOf(nodeId) - 200;
      const voteBlockEnd = html.indexOf(nodeId) + 300;
      
      if (voteBlockStart < 0) continue;
      
      const voteBlock = html.substring(Math.max(0, voteBlockStart), 
                                       Math.min(html.length, voteBlockEnd));
      
      // Extract votes using the exact pattern provided
      let votesUp = 0;
      const voteUpMatch = voteBlock.match(/<span class="nvb voteup"><i class="fa fa-plus"><\/i><span>(\d+)<\/span><\/span>/);
      if (voteUpMatch) {
        votesUp = parseInt(voteUpMatch[1], 10);
      }
      
      let votesDown = 0;
      const voteDownMatch = voteBlock.match(/<span class="nvb votedown"><i class="fa fa-minus"><\/i><span>(\d+)<\/span><\/span>/);
      if (voteDownMatch) {
        votesDown = parseInt(voteDownMatch[1], 10);
      }
      
      // Find the title by looking for the node link
      const titleRegex = new RegExp(`<a[^>]*?href="\/node\/${id}"[^>]*?>([^<]+)<\/a>`);
      const titleMatch = voteBlock.match(titleRegex) || html.match(titleRegex);
      
      if (!titleMatch) continue;
      
      let title = titleMatch[1].trim();
      
      // Skip expired deals
      const isExpired = title.toLowerCase().includes('expired') || 
                      voteBlock.toLowerCase().includes('expired');
      
      if (isExpired) continue;
      
      // Extract category
      let category = '';
      const categoryMatch = title.match(/^\[([^\]]+)\]/) || voteBlock.match(/\[([^\]]+)\]/);
      if (categoryMatch) {
        category = categoryMatch[1].trim();
      }
      
      // Clean up title
      title = title.replace(/\s+/g, ' ').trim();
      title = title.replace(/^\s*\[[^\]]+\]/, '').trim();
      
      deals.push({
        id,
        title,
        link: `https://www.ozbargain.com.au/node/${id}`,
        sourceUrl,
        votes: {
          positive: votesUp,
          negative: votesDown,
          total: votesUp - votesDown
        },
        categories: [category].filter(Boolean),
        isExpired: false
      });
    }
    
    // If we didn't find any deals with the primary method, try the fallback
    if (deals.length === 0) {
      const dealRegex = /<a[^>]*?href="\/node\/(\d+)"[^>]*?>([^<]+)<\/a>/g;
      let match;
      
      while ((match = dealRegex.exec(html)) !== null) {
        const id = match[1];
        let title = match[2].trim();
        
        if (title.length < 5) continue;
        
        // Find the vote div using data-nid attribute
        const voteBlockRegex = new RegExp(`<div[^>]*?data-nid="${id}"[^>]*?>[\\s\\S]*?<\\/div>`);
        const voteBlockMatch = html.match(voteBlockRegex);
        
        let votesUp = 0;
        let votesDown = 0;
        
        if (voteBlockMatch) {
          const voteBlock = voteBlockMatch[0];
          const voteUpMatch = voteBlock.match(/<span class="nvb voteup"><i class="fa fa-plus"><\/i><span>(\d+)<\/span><\/span>/);
          if (voteUpMatch) {
            votesUp = parseInt(voteUpMatch[1], 10);
          }
          
          const voteDownMatch = voteBlock.match(/<span class="nvb votedown"><i class="fa fa-minus"><\/i><span>(\d+)<\/span><\/span>/);
          if (voteDownMatch) {
            votesDown = parseInt(voteDownMatch[1], 10);
          }
        }
        
        // Skip expired deals
        const isExpired = title.toLowerCase().includes('expired');
        
        if (isExpired) continue;
        
        // Extract category
        let category = '';
        const categoryMatch = title.match(/^\[([^\]]+)\]/) || 
                             html.substring(match.index, match.index + 200).match(/\[([^\]]+)\]/);
        if (categoryMatch) {
          category = categoryMatch[1].trim();
        }
        
        // Clean up title
        title = title.replace(/\s+/g, ' ').trim();
        title = title.replace(/^\s*\[[^\]]+\]/, '').trim();
        
        deals.push({
          id,
          title,
          link: `https://www.ozbargain.com.au/node/${id}`,
          sourceUrl,
          votes: {
            positive: votesUp,
            negative: votesDown,
            total: votesUp - votesDown
          },
          categories: [category].filter(Boolean),
          isExpired: false
        });
      }
    }
  } 
  else {
    // For AMEX and gift card pages
    const dealRegex = /<a[^>]*?href="\/node\/(\d+)"[^>]*?>([^<]*?)<\/a>/g;
    let match;
    
    while ((match = dealRegex.exec(html)) !== null) {
      const id = match[1];
      let title = match[2].trim();
      
      // Skip irrelevant items
      if (title.length < 5 || match[0].includes('/user/') || match[0].includes('/comment/')) {
        continue;
      }
      
      // Skip if not a node link
      if (!match[0].includes('/node/')) {
        continue;
      }
      
      // Set appropriate title prefixes for special pages
      if (sourceUrl.includes('american-express') && 
          !title.toLowerCase().includes('amex') && 
          !title.toLowerCase().includes('american express')) {
        if (!title.toLowerCase().includes('americanexpress.com')) {
          title = "AMEX Deal: " + title;
        }
      }
      
      if (sourceUrl.includes('gift-card') && 
          !title.toLowerCase().includes('gift card') && 
          !title.toLowerCase().includes('voucher')) {
        title = "Gift Card: " + title;
      }
      
      // Skip expired deals
      const isExpired = title.toLowerCase().includes('expired');
      if (isExpired) continue;
      
      // Clean up the title
      title = title.replace(/\s+/g, ' ').trim();
      title = title.replace(/\[expired\]/i, '').trim();
      title = title.replace(/^\s*\[[^\]]+\]/, '').trim();
      
      // Set category based on page
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
    // Include all AMEX and gift card deals
    if (deal.sourceUrl.includes('american-express') || deal.sourceUrl.includes('gift-card')) {
      return true;
    }
    
    // For main pages, include only deals that exceed the vote threshold
    if (deal.sourceUrl.includes('?page=')) {
      return deal.votes.positive > hotDealThreshold;
    }
    
    return false;
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
