function normalizeShopeeLink(link) {
  if (!link) return link;
  link = link.trim();
  // Nếu link bắt đầu bằng shopee.vn hoặc s.shopee.vn mà không có protocol
  if (/^(?:www\.)?(?:s\.)?shopee\.vn/.test(link) && !/^https?:\/\//i.test(link)) {
    return "https://" + link;
  }
  return link;
}

function getOriginalLinkFromText(text, normalizedLink) {
  // Tìm link gốc trong text tương ứng với normalizedLink
  // Ví dụ: normalizedLink = "https://s.shopee.vn/20lAGz1SWE" 
  // có thể match với "s.shopee.vn/20lAGz1SWE" trong text
  const patterns = [
    normalizedLink,
    normalizedLink.replace(/^https?:\/\//i, ""),
    normalizedLink.replace(/^https?:\/\/(?:www\.)?/i, "")
  ];
  
  for (const pattern of patterns) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    if (regex.test(text)) {
      const match = text.match(regex);
      if (match) return match[0];
    }
  }
  return normalizedLink;
}

function extractShopeeLinks(text) {
  const links = [];
  const rawToNormalized = {}; // Mapping raw link -> normalized link
  // Regex hỗ trợ cả link có protocol và không có protocol
  const regex = /(?:https?:\/\/)?(?:www\.)?(?:s\.)?[^\s"']*shopee\.vn[^\s"']*/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const rawLink = match[0];
    const normalizedLink = normalizeShopeeLink(rawLink);
    rawToNormalized[rawLink] = normalizedLink;
    links.push({ raw: rawLink, normalized: normalizedLink });
  }
  const normalizedLinks = links.map(l => l.normalized);
  const unique = Array.from(new Set(normalizedLinks));
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return { links: unique, rawToNormalized: {}, mode: "none" };
  }
  const tokens = trimmed.split(/\s+/);
  // Kiểm tra xem có phải là plain links không (chỉ có link, không có text khác)
  const isPlainLinks = tokens.length === links.length &&
    links.every(l => tokens.some(t => t === l.raw || t.includes(l.raw) || l.raw.includes(t)));
  return { links: unique, rawToNormalized, mode: isPlainLinks ? "plain-links" : "text" };
}

function replaceLinksInText(text, mapping) {
  let result = text;
  const entries = Object.entries(mapping)
    .filter(([orig, data]) => data && data.shortLink)
    .sort((a, b) => b[0].length - a[0].length);
  entries.forEach(([orig, data]) => {
    // Thử thay thế bằng link gốc trong text trước
    const originalLinkInText = getOriginalLinkFromText(result, orig);
    if (originalLinkInText && originalLinkInText !== orig && result.includes(originalLinkInText)) {
      result = result.split(originalLinkInText).join(data.shortLink);
    } else {
      result = result.split(orig).join(data.shortLink);
    }
  });
  return result;
}

document.addEventListener("DOMContentLoaded", () => {
  const inputEl = document.getElementById("inputText");
  const outputEl = document.getElementById("outputText");
  const statusEl = document.getElementById("status");
  const convertBtn = document.getElementById("convertBtn");
  const copyOutputBtn = document.getElementById("copyOutputBtn");
  const addSubIdBtn = document.getElementById("addSubIdBtn");
  const subIdContainer = document.getElementById("subIdContainer");
  const closeBtn = document.getElementById("closeBtn");
  const historyContainer = document.getElementById("historyContainer");
  const clearHistoryBtn = document.getElementById("clearHistoryBtn");
  const clearInputBtn = document.getElementById("clearInputBtn");
  const accountNameInput = document.getElementById("accountName");
  const saveAccountNameBtn = document.getElementById("saveAccountNameBtn");
  const exportAccountBtn = document.getElementById("exportAccountBtn");
  const deleteAccountBtn = document.getElementById("deleteAccountBtn");
  const importAccountBtn = document.getElementById("importAccountBtn");
  const importAccountFile = document.getElementById("importAccountFile");
  const settingsPanel = document.getElementById("settingsPanel");
  const settingsBtn = document.getElementById("settingsBtn");
  const closeSettingsBtn = document.getElementById("closeSettingsBtn");
  const accountSelect = document.getElementById("accountSelect");
  const helpBtn = document.getElementById("helpBtn");
  const helpPanel = document.getElementById("helpPanel");
  const closeHelpBtn = document.getElementById("closeHelpBtn");
  const deleteConfirm = document.getElementById("deleteConfirm");
  const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
  const cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
  const accountStatusDot = document.getElementById("accountStatusDot");
  const AFFILIATE_URL = "https://affiliate.shopee.vn";
  const qrDonateBtn = document.getElementById("qrDonateBtn");
  const qrModal = document.getElementById("qrModal");
  const qrModalClose = document.getElementById("qrModalClose");
  let accounts = [];
  let currentAccountId = "";

  function detectAffiliateId() {
    return new Promise((resolve) => {
      if (!chrome.tabs || !chrome.scripting) {
        resolve("");
        return;
      }

      function extractInTab(tabId) {
        chrome.scripting.executeScript(
          {
            target: { tabId },
            func: () => {
              try {
                const candidates = Array.from(document.querySelectorAll("label, span, div"));
                const labelEl = candidates.find((el) =>
                  /Affiliate ID/i.test((el.textContent || "").trim())
                );
                if (!labelEl) return "";
                let container =
                  labelEl.closest("tr, .form-group, .shopee-form-item, .row") ||
                  labelEl.parentElement ||
                  labelEl;
                const input = container.querySelector("input");
                if (input && input.value) return input.value.trim();
                const textEl = container.querySelector("span,div");
                if (textEl && textEl.textContent) return textEl.textContent.trim();
                return "";
              } catch (e) {
                return "";
              }
            }
          },
          (results) => {
            if (chrome.runtime.lastError || !results || !results.length) {
              resolve("");
              return;
            }
            const value = results[0].result;
            resolve(typeof value === "string" ? value : "");
          }
        );
      }

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = (tabs && tabs[0]) || null;
        const activeUrl = activeTab && activeTab.url;

        // Nếu đang ở bất kỳ trang affiliate.shopee.vn/* thì thử extract trực tiếp trước
        if (activeTab && activeTab.id && /^https:\/\/affiliate\.shopee\.vn\//.test(activeUrl || "")) {
          extractInTab(activeTab.id);
          return;
        }

        // Nếu không phải, mở tab account_setting ẩn để lấy Affiliate ID
        chrome.tabs.create(
          { url: AFFILIATE_URL + "/account_setting", active: false },
          (newTab) => {
            if (!newTab || !newTab.id) {
              resolve("");
              return;
            }
            const tabId = newTab.id;
            // Đợi trang load xong tương đối rồi mới inject
            setTimeout(() => {
              extractInTab(tabId);
              // Không đóng tab tự động để tránh gây khó chịu, user có thể đóng nếu muốn
            }, 2000);
          }
        );
      });
    });
  }

  function setAccountStatus(status) {
    const statuses = ["status-active", "status-inactive", "status-unknown"];
    accountStatusDot.classList.remove(...statuses);
    if (status === "active") {
      accountStatusDot.classList.add("status-active");
      accountStatusDot.title = "Phiên đang hoạt động";
    } else if (status === "inactive") {
      accountStatusDot.classList.add("status-inactive");
      accountStatusDot.title = "Phiên có thể đã hết hạn";
    } else {
      accountStatusDot.classList.add("status-unknown");
      accountStatusDot.title = "Chưa xác định trạng thái phiên";
    }
  }

  function evaluateConversionStatus(mapping, requestedLinks) {
    const total = (requestedLinks || []).length;
    let successCount = 0;
    let failCount = 0;
    (requestedLinks || []).forEach((lnk) => {
      const data = mapping && mapping[lnk];
      if (data && data.shortLink) {
        successCount += 1;
      } else {
        failCount += 1;
      }
    });
    return {
      successCount,
      failCount,
      total,
      allFailed: total > 0 && successCount === 0
    };
  }

  function setStatus(msg, isError) {
    statusEl.textContent = msg || "";
    statusEl.style.color = isError ? "#ff6b6b" : "#666666";
  }

  function getAffiliateCookies() {
    return new Promise((resolve) => {
      if (!chrome.cookies || !chrome.cookies.getAll) {
        resolve([]);
        return;
      }
      chrome.cookies.getAll({ url: AFFILIATE_URL }, (cookies) => {
        const safe = (cookies || []).map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: c.sameSite,
          expirationDate: c.expirationDate
        }));
        resolve(safe);
      });
    });
  }

  function setAffiliateCookie(cookie) {
    return new Promise((resolve, reject) => {
      if (!chrome.cookies || !chrome.cookies.set) {
        reject(new Error("Không thể đặt cookie: thiếu quyền cookies."));
        return;
      }
      const { name, value, domain, path, secure, httpOnly, sameSite, expirationDate } = cookie || {};
      if (!name || typeof value !== "string") {
        resolve();
        return;
      }
      chrome.cookies.set(
        {
          url: AFFILIATE_URL,
          name,
          value,
          domain,
          path: path || "/",
          secure: Boolean(secure),
          httpOnly: Boolean(httpOnly),
          sameSite,
          expirationDate
        },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(res);
          }
        }
      );
    });
  }

  function openSettings() {
    settingsPanel.classList.add("open");
  }

  function closeSettings() {
    settingsPanel.classList.remove("open");
  }

  function toggleSettings() {
    settingsPanel.classList.toggle("open");
  }

  function openHelp() {
    helpPanel.classList.add("open");
  }

  function closeHelp() {
    helpPanel.classList.remove("open");
  }

  function loadAccountName(data) {
    const val = typeof data.accountName === "string" ? data.accountName : "";
    accountNameInput.value = val || "";
  }

  function createSubIdRow(value, index) {
    const row = document.createElement("div");
    row.className = "subid-row";

    const label = document.createElement("div");
    label.className = "subid-label";
    label.textContent = "SubID " + (index + 1);

    const input = document.createElement("input");
    input.className = "subid-input";
    input.type = "text";
    input.value = value || "";
    input.placeholder = "VD: tiktok_10_2025";

    const removeBtn = document.createElement("button");
    removeBtn.className = "subid-remove";
    removeBtn.textContent = "×";
    removeBtn.title = "Xóa SubID này";

    removeBtn.addEventListener("click", () => {
      subIdContainer.removeChild(row);
      syncLabels();
      saveSubIds();
    });

    input.addEventListener("input", () => {
      saveSubIds();
    });

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(removeBtn);
    return row;
  }

  function getSubIdsFromUI() {
    const values = [];
    const inputs = subIdContainer.querySelectorAll(".subid-input");
    inputs.forEach((input) => {
      values.push(input.value || "");
    });
    return values;
  }

  function syncLabels() {
    const labels = subIdContainer.querySelectorAll(".subid-label");
    labels.forEach((label, idx) => {
      label.textContent = "SubID " + (idx + 1);
    });
  }

  function renderSubIds(subIds) {
    subIdContainer.innerHTML = "";
    const list = (subIds && subIds.length ? subIds : [""]).slice(0, 5);
    list.forEach((value, idx) => {
      const row = createSubIdRow(value, idx);
      subIdContainer.appendChild(row);
    });
    syncLabels();
  }

  function saveSubIds() {
    const subIds = getSubIdsFromUI();
    chrome.storage.local.set({ subIds });
  }

  addSubIdBtn.addEventListener("click", () => {
    const currentCount = subIdContainer.querySelectorAll(".subid-row").length;
    if (currentCount >= 5) {
      setStatus("Tối đa 5 SubID.", true);
      return;
    }
    const row = createSubIdRow("", currentCount);
    subIdContainer.appendChild(row);
    syncLabels();
    saveSubIds();
  });

  chrome.storage.local.get(["subIds", "lastInput", "lastOutput", "accountName", "accounts", "currentAccountId"], (data) => {
    const subIds = Array.isArray(data.subIds) ? data.subIds : [""];
    renderSubIds(subIds);
    if (typeof data.lastInput === "string") {
      inputEl.value = data.lastInput;
    }
    if (typeof data.lastOutput === "string") {
      outputEl.value = data.lastOutput;
    }
    loadAccountName(data);
    accounts = Array.isArray(data.accounts) ? data.accounts : [];
    currentAccountId = typeof data.currentAccountId === "string" ? data.currentAccountId : "";
    // Nếu đã có danh sách tài khoản lưu, ưu tiên dùng tài khoản đã lưu
    if (accounts.length > 0) {
      if (!currentAccountId) {
        currentAccountId = accounts[0].id;
      }
      renderAccountSelect();
      if (currentAccountId) {
        applyAccountById(currentAccountId, false);
      } else {
        setAccountStatus("unknown");
      }
    } else {
      // Chưa có tài khoản lưu -> cố gắng đọc Affiliate ID trực tiếp từ trang account_setting hiện tại
      renderAccountSelect();
      detectAffiliateId().then((affId) => {
        if (affId) {
          currentAccountId = String(affId);
          setAccountStatus("unknown");
        } else {
          setAccountStatus("unknown");
        }
      });
    }
  });

  convertBtn.addEventListener("click", () => {
    const raw = inputEl.value || "";
    const trimmed = raw.trim();
    if (!trimmed) {
      setStatus("Vui lòng dán link Shopee hoặc đoạn văn bản chứa link.", true);
      return;
    }

    chrome.storage.local.set({ lastInput: raw });

    const { links, rawToNormalized, mode } = extractShopeeLinks(raw);
    if (!links.length) {
      setStatus("Không tìm thấy link Shopee nào trong nội dung.", true);
      return;
    }

    const subIds = getSubIdsFromUI();

    convertBtn.disabled = true;
    convertBtn.textContent = "Đang convert...";
    setStatus("Đang gửi tới Shopee Affiliate...", false);

    chrome.runtime.sendMessage(
      {
        type: "CONVERT_LINKS",
        links,
        subIds
      },
      (resp) => {
        convertBtn.disabled = false;
        convertBtn.textContent = "Convert link";

        if (!resp || !resp.ok) {
          setStatus("Lỗi khi convert: " + (resp && resp.error || "không rõ"), true);
          setAccountStatus("inactive");
          return;
        }

        const mapping = resp.mapping || {};
        // Tạo mapping từ raw link sang shortLink để replace trong text
        const rawMapping = {};
        Object.keys(rawToNormalized).forEach(rawLink => {
          const normalizedLink = rawToNormalized[rawLink];
          if (mapping[normalizedLink] && mapping[normalizedLink].shortLink) {
            rawMapping[rawLink] = mapping[normalizedLink];
            // Cũng thêm mapping cho normalized link
            rawMapping[normalizedLink] = mapping[normalizedLink];
          }
        });
        
        let output = "";

        if (mode === "plain-links") {
          const lines = links.map(normalizedLink => {
            const data = mapping[normalizedLink];
            return (data && data.shortLink) || normalizedLink;
          });
          output = lines.join("\n");
        } else {
          output = replaceLinksInText(raw, rawMapping);
        }

        outputEl.value = output;
        chrome.storage.local.set({ lastOutput: output });
        const { successCount, failCount, total, allFailed } = evaluateConversionStatus(mapping, links);
        if (allFailed) {
          setStatus("Phiên đăng nhập có thể đã hết hạn. Vui lòng mở affiliate.shopee.vn, đăng nhập lại rồi thử convert.", true);
          setAccountStatus("inactive");
        } else if (failCount > 0) {
          setStatus(`Đã convert ${successCount}/${total} link. Một số link không đổi, hãy kiểm tra đăng nhập/SubID.`, true);
          setAccountStatus("active");
        } else {
          setStatus("Đã convert " + links.length + " link.", false);
          setAccountStatus("active");
        }
        
        // Lưu vào lịch sử
        saveToHistory(raw, output, links.length);
      }
    );
  });

  copyOutputBtn.addEventListener("click", () => {
    const text = outputEl.value || "";
    if (!text.trim()) {
      setStatus("Không có nội dung để copy.", true);
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => setStatus("Đã copy kết quả vào clipboard.", false),
        () => setStatus("Không copy được vào clipboard.", true)
      );
    } else {
      setStatus("Trình duyệt không hỗ trợ clipboard API.", true);
    }
  });

  closeBtn.addEventListener("click", () => {
    window.close();
  });

  clearInputBtn.addEventListener("click", () => {
    inputEl.value = "";
    inputEl.focus();
    setStatus("Đã xóa nội dung đầu vào.", false);
  });

  settingsBtn.addEventListener("click", () => {
    toggleSettings();
  });

  closeSettingsBtn.addEventListener("click", () => {
    closeSettings();
  });

  helpBtn.addEventListener("click", () => {
    openHelp();
  });

  closeHelpBtn.addEventListener("click", () => {
    closeHelp();
  });

  function renderAccountSelect() {
    accountSelect.innerHTML = `<option value="">(Chưa chọn tài khoản)</option>`;
    accounts.forEach((acc) => {
      const option = document.createElement("option");
      option.value = acc.id;
      // Mặc định hiển thị theo ID; nếu đã đặt tên thì hiển thị tên
      option.textContent = acc.name || acc.id || "Không tên";
      accountSelect.appendChild(option);
    });
    if (currentAccountId) {
      accountSelect.value = currentAccountId;
    }
  }

  function persistAccounts() {
    chrome.storage.local.set({
      accounts,
      currentAccountId,
      accountName: accountNameInput.value || "",
      subIds: getSubIdsFromUI()
    });
  }

  function applyAccount(account, showStatus = true) {
    if (!account) return;
    loadAccountName({ accountName: account.name || account.id || "" });
    setAccountStatus("unknown");
    renderSubIds(account.subIds && account.subIds.length ? account.subIds.slice(0, 5) : [""]);
    const cookies = Array.isArray(account.cookies) ? account.cookies : [];
    Promise.all(cookies.map((c) => setAffiliateCookie(c).catch(() => null)))
      .then(() => {
        if (showStatus) setStatus("Đã áp dụng tài khoản " + (account.name || ""), false);
      })
      .catch(() => {
        if (showStatus) setStatus("Không thể đặt cookie cho tài khoản này.", true);
      });
  }

  function applyAccountById(id, showStatus = true) {
    const account = accounts.find((a) => a.id === id);
    if (!account) return;
    currentAccountId = id;
    renderAccountSelect();
    applyAccount(account, showStatus);
    persistAccounts();
  }

  accountSelect.addEventListener("change", () => {
    const id = accountSelect.value;
    if (!id) {
      currentAccountId = "";
      setAccountStatus("unknown");
      persistAccounts();
      return;
    }
    applyAccountById(id, true);
  });

  saveAccountNameBtn.addEventListener("click", () => {
    const name = accountNameInput.value || "";
    const subIds = getSubIdsFromUI();
    setStatus("Đang lưu tài khoản...", false);
    Promise.all([detectAffiliateId(), getAffiliateCookies()])
      .then(([affId, cookies]) => {
        const id = (affId && String(affId)) || currentAccountId || Date.now().toString();
        const payload = { id, name, subIds, cookies };
        const existingIdx = accounts.findIndex((a) => a.id === payload.id);
        if (existingIdx >= 0) {
          accounts[existingIdx] = payload;
        } else {
          accounts.push(payload);
        }
        currentAccountId = payload.id;
        renderAccountSelect();
        accountSelect.value = currentAccountId;
        chrome.storage.local.set({ accountName: name }, () => {
          persistAccounts();
          setStatus("Đã lưu tài khoản.", false);
        });
      })
      .catch(() => {
        setStatus("Không thể lấy cookie để lưu tài khoản.", true);
      });
  });

  exportAccountBtn.addEventListener("click", () => {
    const accountName = accountNameInput.value || currentAccountId || "";
    const subIds = getSubIdsFromUI();
    setStatus("Đang xuất thông tin đăng nhập...", false);
    const selectedAccount = accounts.find((a) => a.id === currentAccountId);
    const cookiePromise =
      selectedAccount && Array.isArray(selectedAccount.cookies) && selectedAccount.cookies.length
        ? Promise.resolve(selectedAccount.cookies)
        : getAffiliateCookies();
    cookiePromise
      .then((cookies) => {
        const payload = { accountName, subIds, cookies };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "shopee-affiliate-account.json";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus("Đã xuất JSON đăng nhập (cookie + SubID).", false);
      })
      .catch(() => {
        setStatus("Không thể lấy cookie. Kiểm tra quyền cookies.", true);
      });
  });

  importAccountBtn.addEventListener("click", () => {
    importAccountFile.click();
  });

  importAccountFile.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result || "{}");
        const accountName = typeof data.accountName === "string" ? data.accountName : "";
        const subIds = Array.isArray(data.subIds) && data.subIds.length ? data.subIds.slice(0, 5) : [""];
        const cookies = Array.isArray(data.cookies) ? data.cookies : [];

        const newAccount = {
          id: Date.now().toString(),
          name: accountName || Date.now().toString(),
          subIds,
          cookies
        };

        Promise.all(cookies.map((c) => setAffiliateCookie(c).catch(() => null)))
          .then(() => {
            accounts.push(newAccount);
            currentAccountId = newAccount.id;
            chrome.storage.local.set({ accountName, subIds, accounts, currentAccountId }, () => {
              renderAccountSelect();
              accountSelect.value = currentAccountId;
              loadAccountName({ accountName });
              setAccountStatus("unknown");
              renderSubIds(subIds);
              setStatus("Đã nhập JSON tài khoản, cookie và thêm vào danh sách.", false);
            });
          })
          .catch(() => {
            setStatus("Không thể đặt cookie. Kiểm tra quyền cookies.", true);
          });
      } catch (err) {
        setStatus("File JSON không hợp lệ.", true);
      } finally {
        importAccountFile.value = "";
      }
    };
    reader.readAsText(file);
  });

  function showDeleteConfirm() {
    deleteConfirm.classList.add("show");
  }

  function hideDeleteConfirm() {
    deleteConfirm.classList.remove("show");
  }

  deleteAccountBtn.addEventListener("click", () => {
    showDeleteConfirm();
  });

  cancelDeleteBtn.addEventListener("click", () => {
    hideDeleteConfirm();
  });

  confirmDeleteBtn.addEventListener("click", () => {
    const defaults = { accountName: "", subIds: [""], lastInput: "", lastOutput: "", history: [] };
    if (currentAccountId) {
      accounts = accounts.filter((a) => a.id !== currentAccountId);
      currentAccountId = "";
    }
    chrome.storage.local.set({ ...defaults, accounts, currentAccountId }, () => {
      renderAccountSelect();
      renderSubIds([""]);
      inputEl.value = "";
      outputEl.value = "";
      accountNameInput.value = "";
      setAccountStatus("unknown");
      renderHistory();
      setStatus("Đã xóa tài khoản hiện tại và dữ liệu liên quan.", false);
      hideDeleteConfirm();
    });
  });

  function saveToHistory(input, output, linkCount) {
    chrome.storage.local.get({ history: [] }, (data) => {
      const history = Array.isArray(data.history) ? data.history : [];
      const historyItem = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        input: input.substring(0, 200), // Giới hạn độ dài
        output: output.substring(0, 200),
        linkCount: linkCount,
        fullInput: input,
        fullOutput: output
      };
      
      // Thêm vào đầu mảng
      history.unshift(historyItem);
      
      // Giữ tối đa 10 items
      const limitedHistory = history.slice(0, 10);
      
      chrome.storage.local.set({ history: limitedHistory }, () => {
        renderHistory();
      });
    });
  }

  function renderHistory() {
    chrome.storage.local.get({ history: [] }, (data) => {
      const history = Array.isArray(data.history) ? data.history : [];
      
      if (history.length === 0) {
        historyContainer.innerHTML = '<div class="history-empty">Chưa có lịch sử</div>';
        return;
      }
      
      historyContainer.innerHTML = history.map(item => {
        const date = new Date(item.timestamp);
        const timeStr = date.toLocaleString('vi-VN', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        
        const inputPreview = item.input.length > 100 
          ? item.input.substring(0, 100) + '...' 
          : item.input;
        const outputPreview = item.output.length > 100 
          ? item.output.substring(0, 100) + '...' 
          : item.output;
        
        return `
          <div class="history-item" data-id="${item.id}">
            <div class="history-item-header">
              <span class="history-item-time">${timeStr}</span>
              <button class="history-item-delete" data-id="${item.id}" title="Xóa">×</button>
            </div>
            <div class="history-item-content">
              <strong>Input:</strong> ${escapeHtml(inputPreview)}<br>
              <strong>Output:</strong> ${escapeHtml(outputPreview)}
            </div>
            <div class="history-item-preview">Đã convert ${item.linkCount} link</div>
          </div>
        `;
      }).join('');
      
      // Thêm event listeners cho các history items
      historyContainer.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.classList.contains('history-item-delete')) {
            return;
          }
          const id = parseInt(item.dataset.id);
          const historyItem = history.find(h => h.id === id);
          if (historyItem) {
            inputEl.value = historyItem.fullInput;
            outputEl.value = historyItem.fullOutput;
            const date = new Date(historyItem.timestamp);
            const timeStr = date.toLocaleString('vi-VN', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });
            setStatus(`Đã tải lại lịch sử từ ${timeStr}`, false);
          }
        });
      });
      
      // Thêm event listeners cho nút xóa
      historyContainer.querySelectorAll('.history-item-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = parseInt(btn.dataset.id);
          deleteHistoryItem(id);
        });
      });
    });
  }

  function deleteHistoryItem(id) {
    chrome.storage.local.get({ history: [] }, (data) => {
      const history = Array.isArray(data.history) ? data.history : [];
      const filtered = history.filter(item => item.id !== id);
      chrome.storage.local.set({ history: filtered }, () => {
        renderHistory();
      });
    });
  }

  function clearHistory() {
    chrome.storage.local.set({ history: [] }, () => {
      renderHistory();
      setStatus("Đã xóa tất cả lịch sử.", false);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  clearHistoryBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (confirm("Bạn có chắc chắn muốn xóa tất cả lịch sử?")) {
      clearHistory();
    }
  });

  // Load lịch sử khi mở popup
  renderHistory();

  // QR Donate modal
  function openQrModal() {
    if (qrModal) {
      qrModal.classList.add("open");
    }
  }

  function closeQrModal() {
    if (qrModal) {
      qrModal.classList.remove("open");
    }
  }

  if (qrDonateBtn) {
    qrDonateBtn.addEventListener("click", openQrModal);
  }
  if (qrModalClose) {
    qrModalClose.addEventListener("click", closeQrModal);
  }
  if (qrModal) {
    qrModal.addEventListener("click", (e) => {
      if (e.target === qrModal || e.target.classList.contains("qr-modal-backdrop")) {
        closeQrModal();
      }
    });
  }
});
