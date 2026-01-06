## Shopee Affiliate Smart Link – Chrome Extension

Shopee Affiliate Smart Link giúp bạn **chuyển link Shopee thường thành link tiếp thị liên kết (affiliate)** nhanh, chính xác, hỗ trợ nhiều tài khoản và SubID, kèm nút nổi convert nhanh ngay trên trang Shopee.vn.

---

## Tính năng chính

- **Convert link Shopee → link Affiliate**
  - Hỗ trợ link đầy đủ, link rút gọn `s.shopee.vn` và link không có protocol.
  - Nhận diện:
    - Chỉ có link → xuất mỗi dòng 1 link affiliate.
    - Đoạn văn bản chứa nhiều link → chỉ thay thế link, giữ nguyên nội dung text.
  - Sử dụng GraphQL API `batchGetCustomLink` của Shopee Affiliate qua endpoint:
    - `https://affiliate.shopee.vn/api/v3/gql?q=batchCustomLink`

- **Quản lý SubID (tối đa 5)**
  - Thêm / xoá SubID ở phần **“SubID (tối đa 5)”**.
  - Tự lưu SubID vào `chrome.storage.local`.
  - Mỗi lần convert, SubID được gửi kèm (`subId1` … `subId5`) lên Shopee Affiliate.

- **Quản lý nhiều tài khoản Affiliate**
  - Lưu tài khoản (Affiliate ID + cookie + SubID + tên).
  - Chọn tài khoản nhanh qua dropdown trên header.
  - Xuất / nhập JSON để chuyển tài khoản giữa các máy.
  - Xoá tài khoản hiện tại (kèm reset dữ liệu liên quan).

- **Trạng thái phiên (chấm xanh / đỏ / xám)**
  - **Xanh**: convert thành công (phiên hoạt động).
  - **Đỏ**: tất cả link lỗi, khả năng cao phiên hết hạn (hiển thị gợi ý đăng nhập lại).
  - **Xám**: chưa xác định (mới chọn tài khoản / mới mở popup).

- **Nút nổi trên Shopee.vn**
  - Chạy trên `https://shopee.vn/*` và `https://*.shopee.vn/*`.
  - Button `⚡ Convert link Shopee` ở góc phải dưới:
    - Lấy URL hiện tại.
    - Convert sang link affiliate với SubID đang lưu.
    - Tự copy link affiliate vào clipboard (nếu được) và hiển thị toast.

- **Lịch sử convert**
  - Lưu tối đa 10 lượt convert gần nhất (input rút gọn, output rút gọn, full input/output, số link).
  - Click 1 item trong lịch sử để load lại input/output.
  - Xoá từng bản ghi hoặc xoá toàn bộ lịch sử.

- **Donate & liên hệ**
  - Header hiển thị:
    - `Develop by Diệp Văn Tiến` (link GitHub).
    - `Nhận code tools theo yêu cầu liên hệ fb Diệp Văn Tiến` (link Facebook).
    - `Donate: Momo · buymeacoffee · QR` (QR mở modal hiển thị ảnh `QR.png`).

---

## Hướng dẫn sử dụng

### A. Chuẩn bị

1. Đăng nhập Shopee Affiliate ở `https://affiliate.shopee.vn/`.
2. Mở một trang bất kỳ trong `affiliate.shopee.vn` (VD: Dashboard / account_setting) để đảm bảo cookie hợp lệ.

### B. Convert link từ popup

1. Bấm icon extension để mở popup.
2. Ở ô **“Link / văn bản đầu vào”**:
   - Dán 1 hoặc nhiều link Shopee **hoặc** đoạn text chứa nhiều link Shopee.
3. Nhập SubID (tối đa 5) nếu cần tracking chiến dịch.
4. Bấm **“Convert link”**:
   - Kết quả hiển thị ở ô **“Kết quả”**.
   - Status báo số link xử lý và trạng thái phiên (xanh/đỏ/xám).
   - Lịch sử được lưu lại.
5. Bấm **“Copy”** để copy toàn bộ kết quả.

### C. Convert nhanh từ trang Shopee.vn

1. Mở trang sản phẩm / danh mục / landing bất kỳ trên `shopee.vn`.
2. Click nút **“⚡ Convert link Shopee”** ở góc phải dưới.
3. Extension:
   - Lấy URL hiện tại.
   - Convert sang link affiliate (kèm SubID).
   - Copy vào clipboard và hiển thị toast thông báo.

### D. Quản lý tài khoản Affiliate

1. Mở popup → bấm nút **⚙️ Cài đặt**.
2. Nhập **Tên tài khoản**, chỉnh SubID mong muốn.
3. Bấm **“Lưu”**:
   - Extension đọc Affiliate ID (nếu có) + cookie + SubID → lưu thành một tài khoản.
4. Dùng dropdown ở header để:
   - Chọn tài khoản → tự động set cookie + SubID.
   - Theo dõi trạng thái phiên bằng chấm màu.
5. Dùng **Xuất JSON / Nhập JSON** để:
   - Backup và chia sẻ tài khoản cho máy khác (bao gồm cookie + SubID).

---

## Quyền (Permissions)

Extension cần các quyền sau:

- `storage` – lưu SubID, tài khoản, lịch sử.
- `activeTab` – đọc URL tab hiện tại (convert nhanh).
- `scripting` – inject script để lấy Affiliate ID, content script cho Shopee.
- `cookies` – đọc/ghi cookie tại `https://affiliate.shopee.vn`.

`host_permissions`:

- `https://affiliate.shopee.vn/*`
- `https://shopee.vn/*`
- `https://*.shopee.vn/*`

> Dữ liệu chỉ được gửi tới API chính thức của Shopee Affiliate để tạo link. Lịch sử, tài khoản, SubID… chỉ lưu local trên trình duyệt của bạn (`chrome.storage.local`).

---

## Tác giả & liên hệ

- **Diệp Văn Tiến**
  - GitHub: [`https://github.com/diepvantien`](https://github.com/diepvantien)
  - Facebook: [`https://www.facebook.com/tixu.no`](https://www.facebook.com/tixu.no)
  - Buy Me a Coffee: [`https://buymeacoffee.com/tixuno`](https://buymeacoffee.com/tixuno)

Nếu bạn cần **code tools theo yêu cầu** (extension, automation, tracking, dashboard,…), có thể liên hệ trực tiếp qua Facebook hoặc tạo issue trên GitHub repo này.


