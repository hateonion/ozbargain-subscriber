import { parseOzBargainFeed } from './xmlParser';

const BLACKLISTED_CATEGORIES = [
  'Gaming',
]

async function handleRequest(request, env) {
  const url = new URL(request.url);
  
  // if (url.searchParams.get('test') === 'true') {
  //   const result = await processAndSendDeals(env);
  //   return new Response(JSON.stringify(result, null, 2), {
  //     headers: { 'Content-Type': 'application/json' }
  //   });
  // }
  
  return new Response('ok', {
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
    'https://www.ozbargain.com.au/deals/popular/feed?days=7&noexpired=1&page=0',
    'https://www.ozbargain.com.au/deals/popular/feed?days=7&noexpired=1&page=1',
    'https://www.ozbargain.com.au/deals/popular/feed?days=7&noexpired=1&page=2',
    'https://www.ozbargain.com.au/deals/popular/feed?days=7&noexpired=1&page=3',
    'https://www.ozbargain.com.au/deals/popular/feed?days=7&noexpired=1&page=4',
    'https://www.ozbargain.com.au/brand/american-express/feed?noexpired=1',
    'https://www.ozbargain.com.au/tag/gift-card/feed?noexpired=1'
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
      
      const xml = await response.text();
      const pageDeals = parseOzBargainFeed(xml);
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



function filterDeals(deals, env) {
  const hotDealThreshold = getHotDealThreshold(env);
  
  return deals.filter(deal => {
    return deal.votesPos >= hotDealThreshold && BLACKLISTED_CATEGORIES.indexOf(deal.category) === -1;``
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
    const emoji = '💰';
    const voteInfo = deal.votesPos > 0 ? `+${deal.votesPos} votes` : '';
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
