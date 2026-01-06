async function convertLinks(links, subIds) {
  const uniqueLinks = Array.from(new Set((links || []).filter(Boolean)));
  if (!uniqueLinks.length) {
    throw new Error("Không có link nào để convert");
  }

  const cleanedSubIds = (subIds || [])
    .map(s => (s || "").trim())
    .filter(Boolean)
    .slice(0, 5);

  const query = `
    query batchGetCustomLink($linkParams: [CustomLinkParam!], $sourceCaller: SourceCaller){
      batchCustomLink(linkParams: $linkParams, sourceCaller: $sourceCaller){
        shortLink
        longLink
        failCode
      }
    }
  `;

  const linkParams = uniqueLinks.map(link => {
    const advancedLinkParams = {};
    cleanedSubIds.forEach((value, index) => {
      const key = "subId" + (index + 1);
      advancedLinkParams[key] = value;
    });
    return {
      originalLink: link,
      advancedLinkParams
    };
  });

  const body = {
    operationName: "batchGetCustomLink",
    query,
    variables: {
      linkParams,
      sourceCaller: "CUSTOM_LINK_CALLER"
    }
  };

  const resp = await fetch("https://affiliate.shopee.vn/api/v3/gql?q=batchCustomLink", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    credentials: "include",
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error("API lỗi: " + resp.status + " " + text);
  }

  const json = await resp.json();
  const list = (((json || {}).data || {}).batchCustomLink) || [];

  const mapping = {};
  uniqueLinks.forEach((link, idx) => {
    const item = list[idx];
    if (item && item.failCode === 0 && item.shortLink) {
      mapping[link] = {
        shortLink: item.shortLink,
        longLink: item.longLink,
        failCode: item.failCode
      };
    } else {
      mapping[link] = {
        error: true,
        failCode: item && item.failCode,
        raw: item || null
      };
    }
  });

  return mapping;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "CONVERT_LINKS") {
    const links = message.links || [];
    const subIds = message.subIds || [];
    convertLinks(links, subIds)
      .then(mapping => {
        sendResponse({ ok: true, mapping });
      })
      .catch(err => {
        console.error("[ShopeeAffiliate] CONVERT_LINKS error:", err);
        sendResponse({ ok: false, error: String(err && err.message || err) });
      });
    return true;
  }

  if (message && message.type === "CONVERT_CURRENT_PAGE") {
    const url = message.url;
    if (!url) {
      sendResponse({ ok: false, error: "Không có URL trang hiện tại" });
      return;
    }
    chrome.storage.local.get({ subIds: [] }, (data) => {
      const subIds = data && Array.isArray(data.subIds) ? data.subIds : [];
      convertLinks([url], subIds)
        .then(mapping => {
          sendResponse({ ok: true, mapping });
        })
        .catch(err => {
          console.error("[ShopeeAffiliate] CONVERT_CURRENT_PAGE error:", err);
          sendResponse({ ok: false, error: String(err && err.message || err) });
        });
    });
    return true;
  }
});
