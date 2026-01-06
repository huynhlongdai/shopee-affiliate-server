(function () {
  if (window.__SHOPEE_AFFILIATE_FLOATING_BUTTON__) return;
  window.__SHOPEE_AFFILIATE_FLOATING_BUTTON__ = true;

  const href = location.href || "";
  if (!/https?:\/\/(?:www\.)?shopee\.vn\//.test(href)) {
    return;
  }

  function createToast(msg) {
    const toast = document.createElement("div");
    toast.textContent = msg;
    toast.style.position = "fixed";
    toast.style.zIndex = 2147483647;
    toast.style.right = "16px";
    toast.style.bottom = "112px";
    toast.style.padding = "8px 12px";
    toast.style.background = "rgba(0,0,0,0.85)";
    toast.style.color = "#fff";
    toast.style.borderRadius = "999px";
    toast.style.fontSize = "12px";
    toast.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    toast.style.boxShadow = "0 8px 20px rgba(0,0,0,0.35)";
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";
      setTimeout(() => toast.remove(), 300);
    }, 2200);
  }

  const btn = document.createElement("button");
  btn.textContent = "Convert link Shopee";
  btn.style.position = "fixed";
  btn.style.right = "16px";
  btn.style.bottom = "56px";
  btn.style.zIndex = 2147483647;
  btn.style.border = "none";
  btn.style.borderRadius = "999px";
  btn.style.padding = "8px 14px";
  btn.style.fontSize = "12px";
  btn.style.cursor = "pointer";
  btn.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  btn.style.background = "linear-gradient(135deg, #ff6b00, #ff9500)";
  btn.style.color = "#fff";
  btn.style.boxShadow = "0 4px 12px rgba(255,107,0,0.3)";
  btn.style.display = "flex";
  btn.style.alignItems = "center";
  btn.style.gap = "6px";

  const iconSpan = document.createElement("span");
  iconSpan.textContent = "⚡";
  iconSpan.style.fontSize = "14px";
  btn.prepend(iconSpan);

  btn.addEventListener("mouseenter", () => {
    btn.style.boxShadow = "0 6px 16px rgba(255,107,0,0.4)";
    btn.style.transform = "translateY(-1px)";
    btn.style.background = "linear-gradient(135deg, #ff7b10, #ffa520)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.boxShadow = "0 4px 12px rgba(255,107,0,0.3)";
    btn.style.transform = "translateY(0)";
    btn.style.background = "linear-gradient(135deg, #ff6b00, #ff9500)";
  });

  btn.addEventListener("click", () => {
    if (btn.__busy) return;
    btn.__busy = true;
    const originalText = "Convert link Shopee";
    btn.textContent = "Đang convert...";
    btn.style.opacity = "0.85";

    chrome.runtime.sendMessage(
      {
        type: "CONVERT_CURRENT_PAGE",
        url: location.href
      },
      (resp) => {
        btn.__busy = false;
        btn.style.opacity = "1";
        if (!resp || !resp.ok) {
          createToast("Lỗi convert: " + (resp && resp.error || "không rõ"));
          btn.textContent = originalText;
          return;
        }
        const mapping = resp.mapping || {};
        const data = mapping[location.href] || mapping[href] || Object.values(mapping)[0] || null;
        const shortLink = data && data.shortLink;
        if (!shortLink) {
          createToast("Không tạo được link affiliate");
          btn.textContent = originalText;
          return;
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(shortLink).then(
            () => {
              btn.textContent = "Đã copy link ✅";
              createToast("Đã copy link affiliate");
              setTimeout(() => {
                btn.textContent = originalText;
              }, 1600);
            },
            () => {
              createToast(shortLink);
              btn.textContent = originalText;
            }
          );
        } else {
          createToast(shortLink);
          btn.textContent = originalText;
        }
      }
    );
  });

  document.addEventListener("DOMContentLoaded", () => {
    document.body.appendChild(btn);
  });
  if (document.readyState === "complete" || document.readyState === "interactive") {
    document.body.appendChild(btn);
  }
})();
