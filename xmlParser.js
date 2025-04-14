export function parseOzBargainFeed(xmlString) {
	try {
		// Parse the XML string into a DOM document
		const parser = new DOMParser();
		const xmlDoc = parser.parseFromString(xmlString, "application/xml");

		// Check for parsing errors
		const parserError = xmlDoc.querySelector("parsererror");
		if (parserError) {
			throw new Error("XML parsing failed: " + parserError.textContent);
		}

		// Get all item elements
		const items = xmlDoc.querySelectorAll("item");

		// Array to store the parsed deals
		const deals = [];

		// Current date for expiry checking
		// Process each item
		items.forEach(item => {
			// Extract deal ID from guid or link
			const link = item.querySelector("link").textContent;
			const dealId = link.split("/node/")[1];

			// Extract deal title
			const title = item.querySelector("title").textContent;

			// Extract votes information (positive and negative)
			const ozbMeta = item.querySelector("ozb\\:meta");
			const votesPos = ozbMeta ? parseInt(ozbMeta.getAttribute("votes-pos"), 10) || 0 : 0;

			// Extract deal link (URL to merchant)
			const dealUrl = ozbMeta ? ozbMeta.getAttribute("url") : "";

			// Extract deal image
			const imageUrl = ozbMeta ? ozbMeta.getAttribute("image") : "";

			// Extract category
			const categoryElement = item.querySelector("category");
			const category = categoryElement ? categoryElement.textContent : "";

			// Check if the deal is expired
			let isExpired = false;

			// Check expiry based on ozb:title-msg
			const expiredMsg = item.querySelector("ozb\\:title-msg[type='expired']");
			if (expiredMsg) {
				isExpired = true;
			}

			// Check expiry based on expiry date attribute
			// Add more data as needed
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
		});

		return deals;
	} catch (error) {
		console.error("Error parsing OzBargain feed:", error);
		return [];
	}
}