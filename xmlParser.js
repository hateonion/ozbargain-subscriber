export function parseOzBargainFeed(xmlString) {
  try {
    const deals = [];
    
    // Split the XML string into items
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let itemMatch;
    
    while ((itemMatch = itemRegex.exec(xmlString)) !== null) {
      const itemContent = itemMatch[1];
      
      // Extract deal ID from link
      const linkMatch = /<link>(.*?)<\/link>/.exec(itemContent);
      const link = linkMatch ? linkMatch[1] : '';
      const dealId = link.split('/node/')[1];
      
      // Extract deal title
      const titleMatch = /<title>(.*?)<\/title>/.exec(itemContent);
      const title = titleMatch ? titleMatch[1] : '';
      
      // Extract votes information from ozb:meta
      const ozbMetaMatch = /<ozb:meta([^>]*)>/.exec(itemContent);
      let votesPos = 0;
      let votesNeg = 0;
      let dealUrl = '';
      let imageUrl = '';
      let commentCount = 0;
      
      if (ozbMetaMatch) {
        const metaAttrs = ozbMetaMatch[1];
        
        // Extract votes
        const votesPosMatch = /votes-pos="(\d+)"/.exec(metaAttrs);
        votesPos = votesPosMatch ? parseInt(votesPosMatch[1], 10) : 0;
        
        const votesNegMatch = /votes-neg="(\d+)"/.exec(metaAttrs);
        votesNeg = votesNegMatch ? parseInt(votesNegMatch[1], 10) : 0;
        
        // Extract deal URL
        const urlMatch = /url="([^"]*)"/.exec(metaAttrs);
        dealUrl = urlMatch ? urlMatch[1] : '';
        
        // Extract image URL
        const imageMatch = /image="([^"]*)"/.exec(metaAttrs);
        imageUrl = imageMatch ? imageMatch[1] : '';
        
        // Extract comment count
        const commentMatch = /comment-count="(\d+)"/.exec(metaAttrs);
        commentCount = commentMatch ? parseInt(commentMatch[1], 10) : 0;
      }
      
      // Extract category
      const categoryMatch = /<category domain="[^"]*">([^<]*)<\/category>/.exec(itemContent);
      const category = categoryMatch ? categoryMatch[1] : '';
      
      // Check if the deal is expired
      let isExpired = false;
      
      // Check for expired title message
      const expiredMsgMatch = /<ozb:title-msg type="expired"/.test(itemContent);
      if (expiredMsgMatch) {
        isExpired = true;
      }
      
      deals.push({
        id: dealId,
        title,
        votesPos,
        dealUrl,
        imageUrl,
        category,
        link,
        isExpired
      });
    }
    
    return deals;
  } catch (error) {
    console.error("Error parsing OzBargain feed:", error);
    return [];
  }
}