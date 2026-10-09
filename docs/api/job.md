# Job API — hướng dẫn tích hợp cho FE agent

Tài liệu mô tả các route đang được đăng ký trong `src/modules/job`, đối chiếu controller, DTO, service, domain và Prisma repository. Ví dụ ID/tên bên dưới chỉ để minh họa; lấy ID thật từ API. Swagger tại `/docs`.

## 1. Quy ước chung

- Base URL local: `http://localhost:3000` (hoặc port cấu hình trong `PORT`). Các path bên dưới đã bao gồm `/api`, không thêm prefix lần nữa.
- Body request là JSON với `Content-Type: application/json`. Gửi số dưới dạng JSON number, không gửi chuỗi số từ form.
- Tất cả endpoint trong module hiện yêu cầu `Authorization: Bearer <accessToken>`. Backend lấy danh tính từ JWT, không nhận `userId`, `postedBy` hay `applicantId` từ FE.
- `jobPublicId`, `jobApplicantPublicId`, `resumePublicId` là các ID khác nhau. Category, skill, arrangement dùng ID số.
- Date trên HTTP là chuỗi ISO 8601, nên gửi UTC bằng `date.toISOString()` và đổi sang múi giờ người dùng khi hiển thị.
- Response thành công trả trực tiếp object/array, không bọc trong `{ data: ... }`. `data` của Axios là thuộc tính của Axios response, không phải envelope của backend.
- Tạo/sửa job trả body rỗng. Không gọi `response.json()` vô điều kiện.
- Global validation bật `whitelist`: field ngoài DTO bị loại bỏ. Field không hỗ trợ có thể bị bỏ qua dù request trả thành công.
- Một số field được Swagger đánh dấu optional nhưng validator vẫn bắt buộc. Bảng trong tài liệu này theo validation thực tế.
- CORS local cho phép `http://localhost:5173` và `http://localhost:3000`.

## 2. Danh sách endpoint

| Method | Endpoint                                           | Xác thực/quyền hiện tại                           | Response thành công                     |
| ------ | -------------------------------------------------- | ------------------------------------------------- | --------------------------------------- |
| GET    | `/api/categories`                                  | JWT; không giới hạn role                          | `200`, `ReferenceItem[]`                |
| GET    | `/api/skills`                                      | JWT; không giới hạn role                          | `200`, `ReferenceItem[]`                |
| GET    | `/api/arrangements`                                | JWT; không giới hạn role                          | `200`, `ReferenceItem[]`                |
| GET    | `/api/job`                                         | JWT; không giới hạn role                          | `200`, `PageResult<JobItem>`            |
| POST   | `/api/job`                                         | JWT + `ROLE_COMPANY`                              | `201`, body rỗng                        |
| PATCH  | `/api/job/:jobPublicId`                            | JWT + chủ job                                     | `200`, body rỗng                        |
| POST   | `/api/job/:jobPublicId/apply`                      | JWT + sở hữu resume; chưa có guard role applicant | `201`, `{ message }`                    |
| GET    | `/api/job/applied`                                 | JWT; dữ liệu của người dùng hiện tại              | `200`, `PageResult<JobApplicationItem>` |
| PATCH  | `/api/job/applicants/:jobApplicantPublicId/status` | JWT + `ROLE_COMPANY` + chủ job                    | `200`, `{ message }`                    |

Controller dùng `@Auth()` cho các route chỉ yêu cầu JWT. Riêng tạo job và đổi status hồ sơ dùng `@Auth(RolesGuard)` cùng `@Roles([CommonUserRole.ROLE_COMPANY])`. Kiểm tra chủ job và sở hữu resume thực hiện tại service. FE chỉ cho company đăng job; apply và lịch sử ứng tuyển hiện chưa có guard giới hạn role applicant.

## 3. Reference data cho bộ lọc và form đăng job

### GET `/api/categories`

Request: cần header JWT; không có body, path param hay query được hỗ trợ. Không giới hạn role.

Response `200`:

```json
[{ "id": 1, "name": "Web Development" }]
```

Dùng `id` cho `categoryId` khi tạo job và `categoryIds` khi tìm kiếm.

### GET `/api/skills`

Request: cần header JWT; không có body, path param hay query được hỗ trợ. Không giới hạn role.

Response `200`:

```json
[
  { "id": 1, "name": "TypeScript" },
  { "id": 2, "name": "React" }
]
```

Dùng các `id` cho `skillsId` khi tạo job và `skillIds` khi tìm kiếm. Chú ý tên field khác nhau.

### GET `/api/arrangements`

Request: cần header JWT; không có body, path param hay query được hỗ trợ. Không giới hạn role.

Response `200`:

```json
[{ "id": 1, "name": "Remote" }]
```

Dùng `id` cho `arrangementId` khi tạo job. API tìm kiếm chưa hỗ trợ filter arrangement.

Ba API trả array trực tiếp, có thể trả `[]`, không phân trang và không cam kết thứ tự. Backend cache reference data trong 1 giờ; FE có thể tải song song sau khi đăng nhập và tái sử dụng cho dropdown. Thiếu JWT hoặc JWT không hợp lệ trả `401`. Lỗi repository trả `500` với message tương ứng `Failed to get all categories`, `Failed to get all skills`, `Failed to get all arrangements`.

## 4. GET `/api/job` — tìm kiếm job

Headers: JWT. Không giới hạn role. Request không có body.

| Query         | Kiểu trên URL               | Bắt buộc | Mặc định / validation                                 |
| ------------- | --------------------------- | -------- | ----------------------------------------------------- |
| `pageNumber`  | integer                     | Không    | `1`, tối thiểu `1`                                    |
| `pageSize`    | integer                     | Không    | `20`, tối thiểu `1`; chưa có giới hạn tối đa          |
| `title`       | string                      | Không    | Tìm chuỗi con trong title, không phân biệt hoa/thường |
| `categoryIds` | chuỗi ID ngăn bằng dấu phẩy | Không    | Ví dụ `1,2`; từng giá trị phải là integer             |
| `skillIds`    | chuỗi ID ngăn bằng dấu phẩy | Không    | Ví dụ `1,2,3`; từng giá trị phải là integer           |
| `budgetMin`   | number                      | Không    | `>= 0`, đơn vị VND                                    |
| `budgetMax`   | number                      | Không    | `>= 0`; nếu có min thì `max >= min`; đơn vị VND       |

Ví dụ:

```http
GET /api/job?pageNumber=1&pageSize=20&title=react&categoryIds=1,2&skillIds=1,2&budgetMin=1000000&budgetMax=20000000
Authorization: Bearer <accessToken>
```

Response `200`:

```json
{
  "items": [
    {
      "publicId": "11111111-1111-4111-8111-111111111111",
      "title": "Build a React dashboard",
      "description": "Implement a dashboard for project tracking.",
      "location": "Ho Chi Minh City",
      "budget": 10000000,
      "currency": "VND",
      "skills": [
        { "id": 1, "name": "TypeScript" },
        { "id": 2, "name": "React" }
      ],
      "category": { "id": 1, "name": "Web Development" },
      "arrangement": { "id": 1, "name": "Remote" },
      "dueAt": "2027-12-01T00:00:00.000Z",
      "totalApplicants": 3
    }
  ],
  "totalPages": 1,
  "pageNumber": 1,
  "pageSize": 20,
  "hasPrevious": false,
  "hasNext": false
}
```

Hành vi cần dùng đúng:

- Chỉ trả job có `status = OPEN`. Chưa lọc theo `dueAt`, nên job quá hạn vẫn có thể xuất hiện nếu còn OPEN.
- Các nhóm filter kết hợp bằng AND. Trong `categoryIds` là OR; trong `skillIds` là **khớp ít nhất một skill**, không yêu cầu đủ toàn bộ skills.
- Thứ tự: `createdAt` giảm dần, tiếp theo `dueAt` giảm dần. Không có query đổi sort.
- `budget` trả theo `currency` gốc (`VND` hoặc `USD`), còn filter budget luôn theo VND. Code hiện dùng tỷ lệ cố định `USD × 25_000`, không phải tỷ giá trực tiếp.
- `totalApplicants` đếm các hồ sơ PENDING hoặc ACCEPTED, không đếm REJECTED/COMPLETED.
- Item không có `requirements`, `status`, `postedBy`, `createdAt` hoặc `isApplied`.
- Envelope không có `totalItems`. `totalPages = ceil(totalItems / pageSize)`; khi không có kết quả là `0`, `items = []`. Trang vượt phạm vi không được tự đưa về trang cuối.
- Khi không chọn category/skill, bỏ hẳn query đó; không gửi chuỗi rỗng hay JSON array. Đổi filter nên reset `pageNumber = 1`.

Lỗi: `400` query không hợp lệ; `401` thiếu JWT hoặc JWT không hợp lệ; `500` `Failed to search jobs`.

## 5. POST `/api/job` — tạo job

Headers: JWT + JSON. JWT phải có role `ROLE_COMPANY`. Không có query/path param. **Tất cả field dưới đây bắt buộc**, kể cả những field đang được Swagger đánh dấu optional.

| Body field      | Kiểu JSON            | Validation / ý nghĩa                                           |
| --------------- | -------------------- | -------------------------------------------------------------- |
| `title`         | string               | Tiêu đề                                                        |
| `description`   | string               | Mô tả công việc                                                |
| `requirements`  | string               | Yêu cầu                                                        |
| `budget`        | number               | `>= 0`, theo `currency`                                        |
| `status`        | string enum          | `OPEN` hoặc `CLOSED`                                           |
| `currency`      | string enum          | `VND` hoặc `USD`                                               |
| `categoryId`    | number               | ID category tồn tại; FE gửi integer từ reference API           |
| `skillsId`      | number[]             | Mỗi ID là integer và tồn tại; chấp nhận `[]`, tự loại ID trùng |
| `dueAt`         | ISO date-time string | Date hợp lệ, không được trước thời điểm backend xử lý          |
| `arrangementId` | number               | ID arrangement tồn tại; FE gửi integer từ reference API        |
| `location`      | string               | Địa điểm                                                       |

Validator string hiện không bắt buộc chuỗi khác rỗng. FE nên tự validate các ô cần nội dung trước khi submit.

Request:

```json
{
  "title": "Build a React dashboard",
  "description": "Implement a dashboard for project tracking.",
  "requirements": "Experience with React and TypeScript.",
  "budget": 10000000,
  "status": "OPEN",
  "currency": "VND",
  "categoryId": 1,
  "skillsId": [1, 2],
  "dueAt": "2027-12-01T00:00:00.000Z",
  "arrangementId": 1,
  "location": "Ho Chi Minh City"
}
```

Thay `dueAt` bằng ngày tương lai thực tế khi dùng lại ví dụ.

Response: **`201 Created`, body rỗng**, không có `{ message }`, job object hay `publicId`.

FE hiển thị tạo thành công và làm mới danh sách. Không thể lấy ID job mới chính xác từ response; không suy ra bằng title hay item đầu tiên của search. Tạo CLOSED thì job mới cũng không xuất hiện trong search.

Lỗi:

- `400`: thiếu field/sai kiểu/enum, budget âm, due date trong quá khứ.
- `401`: thiếu JWT hoặc JWT không hợp lệ.
- `403`: JWT không có role `ROLE_COMPANY`; `You do not have permission to access this resource`.
- `404`: `Can not find the job owner`, `Category not found`, `Arrangement not found`, `Skill not found: <ids>`.
- `500`: lỗi kiểm tra reference data hoặc `Failed to create job`.

## 6. PATCH `/api/job/:jobPublicId` — sửa job

Headers: JWT + JSON. Path `jobPublicId`: ID công khai của job. Người gọi phải là chủ job; route chưa có role guard. Không có query.

Chỉ các field sau được hỗ trợ; tất cả optional. Bỏ field để giữ giá trị cũ, không gửi `null`.

| Body field     | Kiểu JSON            | Validation                            |
| -------------- | -------------------- | ------------------------------------- |
| `title`        | string               | Nếu có phải là string                 |
| `description`  | string               | Nếu có phải là string                 |
| `location`     | string               | Nếu có phải là string                 |
| `requirements` | string               | Nếu có phải là string                 |
| `status`       | enum                 | `OPEN` / `CLOSED`                     |
| `dueAt`        | ISO date-time string | Date hợp lệ, không được trong quá khứ |
| `budget`       | number               | `>= 0`, dùng currency đang có của job |

Request ví dụ đóng job:

```http
PATCH /api/job/11111111-1111-4111-8111-111111111111
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "status": "CLOSED"
}
```

Response: **`200 OK`, body rỗng**. Sau khi đóng, job biến mất khỏi search OPEN. Thay đổi status job không tự đổi status các hồ sơ ứng tuyển.

Không hỗ trợ sửa `currency`, `categoryId`, `arrangementId`, `skillsId`. Gửi các field này sẽ bị whitelist loại bỏ. `{}` hiện được chấp nhận; FE nên chỉ submit khi có thay đổi.

Lỗi: `400` validation/domain; `401` JWT; `403` `You are not allowed to update this job`; `404` `Job owner not found` / `Job not found`; `500` lỗi repository.

## 7. POST `/api/job/:jobPublicId/apply` — ứng tuyển

Headers: JWT + JSON. Path `jobPublicId`: ID job cần ứng tuyển. Không có query. Resume phải thuộc người dùng hiện tại.

| Body field       | Kiểu JSON | Bắt buộc | Validation / ý nghĩa                                    |
| ---------------- | --------- | -------- | ------------------------------------------------------- |
| `proposedRate`   | number    | Có       | `>= 0`; API không có field currency riêng cho đề xuất   |
| `estimatedDay`   | number    | Có       | DTO yêu cầu `>= 1`; **FE gửi integer** vì cột DB là Int |
| `coverLetter`    | string    | Có       | Thư ứng tuyển; chưa có validator chuỗi khác rỗng        |
| `resumePublicId` | string    | Có       | ID resume tồn tại và thuộc người dùng                   |

Request:

```json
{
  "proposedRate": 9000000,
  "estimatedDay": 14,
  "coverLetter": "I have experience building React dashboards.",
  "resumePublicId": "22222222-2222-4222-8222-222222222222"
}
```

Response `201`:

```json
{
  "message": "Applied successfully"
}
```

Hồ sơ mới có status PENDING. Response không chứa `jobApplicantPublicId`: sau thành công gọi `/api/job/applied` để đồng bộ dữ liệu và lấy ID hồ sơ. `apply` không tự gọi AI evaluation.

Các giới hạn hiện tại:

- Service chưa kiểm tra role applicant, job OPEN, deadline, trạng thái ingestion của resume hoặc việc người dùng ứng tuyển job của chính mình. FE không nên dựa vào endpoint này để kiểm tra job còn nhận ứng tuyển.
- DB chỉ cho một hồ sơ trên cặp job/người dùng. Apply trùng hiện trả **`500 Failed to add job applicant`**, chưa được map thành `409`. Khóa nút trong lúc submit và dùng lịch sử đã tải để đánh dấu đã ứng tuyển; không tự retry POST khi kết quả chưa rõ.
- `proposedRate` được lưu trực tiếp; backend không có chuyển đổi currency cho field này. Nếu UI hiển thị theo currency của job, đó là quy ước UI cần thống nhất, không phải metadata được trả trong hồ sơ.

Lỗi: `400` validation/domain; `401` JWT; `403` `Resume does not belong to user`; `404` `User not found`, `Job not found`, `Resume not found`; `500` lỗi repository/apply trùng hoặc estimatedDay không lưu được vào Int.

## 8. GET `/api/job/applied` — lịch sử ứng tuyển

Headers: JWT. Không có body/path param. Query chỉ hỗ trợ `pageNumber` (default `1`, integer `>= 1`) và `pageSize` (default `20`, integer `>= 1`).

```http
GET /api/job/applied?pageNumber=1&pageSize=20
Authorization: Bearer <accessToken>
```

Response `200`:

```json
{
  "items": [
    {
      "jobApplicantPublicId": "33333333-3333-4333-8333-333333333333",
      "jobPublicId": "11111111-1111-4111-8111-111111111111",
      "status": "PENDING",
      "resumePublicId": "22222222-2222-4222-8222-222222222222",
      "proposedRate": 9000000,
      "estimatedDays": 14,
      "appliedAt": "2026-10-09T03:00:00.000Z",
      "matchingScore": 0
    }
  ],
  "totalPages": 1,
  "pageNumber": 1,
  "pageSize": 20,
  "hasPrevious": false,
  "hasNext": false
}
```

- Lấy theo applicantId của người gọi, không phải danh sách ứng viên cho company/job.
- Trả mọi status: PENDING, ACCEPTED, REJECTED, COMPLETED; không có query filter status.
- Sắp xếp `appliedAt` giảm dần, sau đó ID nội bộ giảm dần.
- **Request dùng `estimatedDay`, response dùng `estimatedDays`.**
- `matchingScore` lấy từ evaluation mới nhất có overallScore khác null; nếu chưa có thì `0`. Không thể phân biệt “chưa chấm” và “điểm thực sự bằng 0” chỉ bằng field này.
- Không trả title, description, currency, coverLetter hay evaluationPublicId. Search chỉ bổ sung được một phần job OPEN; không đủ để xây lịch sử đầy đủ cho job CLOSED hoặc tải lại trang chi tiết.
- Envelope phân trang giống search, không có `totalItems`.

Lỗi: `400` query; `401` JWT; `404` `Applicant not found`; `500` `Failed to resolve applicant` / `Failed to get jobs applied`.

## 9. PATCH `/api/job/applicants/:jobApplicantPublicId/status` — quyết định tuyển dụng

Headers: JWT + JSON. JWT phải có role `ROLE_COMPANY` và người gọi phải sở hữu job của hồ sơ. Path là **ID hồ sơ ứng tuyển**, không phải ID người dùng hoặc job. Không có query.

Body bắt buộc có `status`, là một giá trị của enum PENDING/ACCEPTED/REJECTED/COMPLETED. Enum hợp lệ vẫn phải thỏa chuyển trạng thái:

| Status hiện tại | Status có thể gửi  |
| --------------- | ------------------ |
| PENDING         | ACCEPTED, REJECTED |
| ACCEPTED        | COMPLETED          |
| REJECTED        | Không có           |
| COMPLETED       | Không có           |

Request:

```http
PATCH /api/job/applicants/33333333-3333-4333-8333-333333333333/status
Authorization: Bearer <companyAccessToken>
Content-Type: application/json
```

```json
{
  "status": "ACCEPTED"
}
```

Response `200`:

```json
{
  "message": "Job applicant status updated successfully"
}
```

Accept một hồ sơ sẽ tự chuyển **các hồ sơ PENDING khác cùng job thành REJECTED** trong transaction. Không tự đóng job. FE cần làm mới toàn bộ danh sách liên quan sau accept, không chỉ sửa một dòng local. Company cần có ID hồ sơ từ dữ liệu hợp lệ khác; module hiện chưa có API liệt kê ứng viên cho company.

| HTTP | Trường hợp / message                                                           |
| ---- | ------------------------------------------------------------------------------ |
| 400  | Sai enum/body; `No need to change status`; `Cannot change <current> to <next>` |
| 401  | JWT thiếu/không hợp lệ                                                         |
| 403  | Không có role company hoặc `Only the job owner can change applicant status`    |
| 404  | `User not found` / `Job applicant was not found`                               |
| 409  | `Job applicant status changed; retry the request` — dữ liệu thay đổi đồng thời |
| 500  | Lỗi đọc context, transaction hoặc lưu status                                   |

Khi `409`, tải lại dữ liệu trước khi cho người dùng quyết định tiếp; không lặp request cũ vô điều kiện.

## 10. Response lỗi và xử lý trên FE

Global exception filter trả:

```json
{
  "statusCode": 403,
  "timestamp": "2026-10-09T03:00:00.000Z",
  "path": "/api/job/11111111-1111-4111-8111-111111111111",
  "message": "You are not allowed to update this job"
}
```

`message` là string. Lỗi class-validator hiện qua filter thường chỉ còn `"Bad Request Exception"`, không có mảng lỗi theo field. FE phải tự validate form và xử lý theo HTTP status; không giả định có `errors`, `code` hay `message[]`. Response lỗi có header `X-Request-ID` để đối chiếu khi báo lỗi.

- `400`: giữ dữ liệu form, hiển thị lỗi input/thao tác không hợp lệ.
- `401`: dùng luồng auth của FE để refresh hoặc đăng nhập lại.
- `403`: hiển thị không đủ quyền, không retry.
- `404`: thông báo dữ liệu không tồn tại; tải lại reference data nếu ID cũ không hợp lệ.
- `409`: refresh trạng thái trước khi thao tác tiếp.
- `500`: thông báo lỗi hệ thống; đối với apply kiểm tra lịch sử trước khi cho submit lại vì có thể đã tồn tại hồ sơ.

## 11. TypeScript contract và mẫu gọi API

Các type này là HTTP payload: date là string, không phải `Date`.

```ts
type JobStatus = 'OPEN' | 'CLOSED';
type Currency = 'VND' | 'USD';
type ApplicationStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'COMPLETED';
type ReferenceItem = { id: number; name: string };
type MessageResponse = { message: string };

type PageResult<T> = {
  items: T[];
  totalPages: number;
  pageNumber: number;
  pageSize: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

type JobItem = {
  publicId: string;
  title: string;
  description: string;
  location: string;
  budget: number;
  currency: Currency;
  skills: ReferenceItem[];
  category: ReferenceItem;
  arrangement: ReferenceItem;
  dueAt: string;
  totalApplicants: number;
};

type JobApplicationItem = {
  jobApplicantPublicId: string;
  jobPublicId: string;
  status: ApplicationStatus;
  resumePublicId: string;
  proposedRate: number;
  estimatedDays: number;
  appliedAt: string;
  matchingScore: number;
};

type CreateJobRequest = {
  title: string;
  description: string;
  requirements: string;
  budget: number;
  status: JobStatus;
  currency: Currency;
  categoryId: number;
  skillsId: number[];
  dueAt: string;
  arrangementId: number;
  location: string;
};

type UpdateJobRequest = Partial<
  Pick<
    CreateJobRequest,
    | 'title'
    | 'description'
    | 'location'
    | 'requirements'
    | 'status'
    | 'dueAt'
    | 'budget'
  >
>;

type ApplyJobRequest = {
  proposedRate: number;
  estimatedDay: number;
  coverLetter: string;
  resumePublicId: string;
};

type ApiErrorResponse = {
  statusCode: number;
  timestamp: string;
  path: string;
  message: string;
};
```

Wrapper `fetch` hỗ trợ cả JSON và body rỗng:

```ts
const API_BASE_URL = 'http://localhost:3000';

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
  }
}

async function api<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && options.body !== null) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const message = (payload as Partial<ApiErrorResponse> | undefined)?.message;
    throw new ApiError(
      response.status,
      typeof message === 'string' ? message : `HTTP ${response.status}`,
      response.headers.get('X-Request-ID'),
    );
  }
  return payload as T;
}

async function loadReferenceData(token: string) {
  const [categories, skills, arrangements] = await Promise.all([
    api<ReferenceItem[]>('/api/categories', {}, token),
    api<ReferenceItem[]>('/api/skills', {}, token),
    api<ReferenceItem[]>('/api/arrangements', {}, token),
  ]);
  return { categories, skills, arrangements };
}

type SearchJobQuery = {
  pageNumber?: number;
  pageSize?: number;
  title?: string;
  categoryIds?: number[];
  skillIds?: number[];
  budgetMin?: number;
  budgetMax?: number;
};

function searchJobs(token: string, query: SearchJobQuery = {}) {
  const params = new URLSearchParams({
    pageNumber: String(query.pageNumber ?? 1),
    pageSize: String(query.pageSize ?? 20),
  });
  if (query.title?.trim()) params.set('title', query.title.trim());
  if (query.categoryIds?.length)
    params.set('categoryIds', query.categoryIds.join(','));
  if (query.skillIds?.length) params.set('skillIds', query.skillIds.join(','));
  if (query.budgetMin !== undefined)
    params.set('budgetMin', String(query.budgetMin));
  if (query.budgetMax !== undefined)
    params.set('budgetMax', String(query.budgetMax));
  return api<PageResult<JobItem>>(`/api/job?${params}`, {}, token);
}

function createJob(body: CreateJobRequest, token: string) {
  return api<void>(
    '/api/job',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    token,
  );
}

function updateJob(jobPublicId: string, body: UpdateJobRequest, token: string) {
  return api<void>(
    `/api/job/${encodeURIComponent(jobPublicId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
    token,
  );
}

function applyJob(jobPublicId: string, body: ApplyJobRequest, token: string) {
  return api<MessageResponse>(
    `/api/job/${encodeURIComponent(jobPublicId)}/apply`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    token,
  );
}

function getAppliedJobs(token: string, pageNumber = 1, pageSize = 20) {
  const params = new URLSearchParams({
    pageNumber: String(pageNumber),
    pageSize: String(pageSize),
  });
  return api<PageResult<JobApplicationItem>>(
    `/api/job/applied?${params}`,
    {},
    token,
  );
}

function updateApplicationStatus(
  jobApplicantPublicId: string,
  status: Exclude<ApplicationStatus, 'PENDING'>,
  token: string,
) {
  return api<MessageResponse>(
    `/api/job/applicants/${encodeURIComponent(jobApplicantPublicId)}/status`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
    token,
  );
}
```

Header `X-Request-ID` hiện chưa được expose qua CORS trong `main.ts`; wrapper có thể đọc được `null` khi gọi khác origin. Không phụ thuộc header này để xử lý lỗi.

## 12. Luồng tích hợp và giới hạn cho FE agent

### Trang tìm việc

1. Yêu cầu đăng nhập trước khi tải trang; truyền access token khi tải categories/skills/arrangements song song. Dùng categories/skills cho filter và reference data cho nhãn hiển thị.
2. Gọi search mặc định kèm access token; debounce ô title, bỏ query chưa chọn, reset page khi filter thay đổi.
3. Hiển thị `budget` với `currency` gốc; nếu UI lọc ngân sách theo USD cần đổi giá trị filter sang VND theo quy ước backend.
4. Nếu đăng nhập applicant, tải lịch sử ứng tuyển để đánh dấu các job đã apply. Một trang lịch sử không chứa toàn bộ hồ sơ; cần tải đủ trang nếu muốn dùng làm tập ID đầy đủ.
5. Hủy/loại response search cũ khi người dùng đổi filter nhanh để tránh ghi đè kết quả mới.

### Form đăng/sửa job của company

1. Chỉ cho tài khoản `ROLE_COMPANY` tạo job; truyền access token khi tải reference data và submit. Dùng reference ID thật; convert giá trị input thành number; gửi due date ISO có timezone.
2. Create cần đủ field. Edit chỉ gửi field được PATCH hỗ trợ và đã thay đổi.
3. Khi nhận `201`/`200` body rỗng, thông báo thành công rồi invalidate danh sách liên quan.
4. Create không trả ID, search không trả requirements/status/owner, và chưa có detail endpoint. Form edit hoàn chỉnh cần nguồn dữ liệu bổ sung từ backend; không điền các field thiếu bằng giá trị giả.

### Ứng tuyển và theo dõi

1. Có resume thuộc người dùng trước khi apply. Luồng tạo resume ở module khác: `POST /api/resume/upload-url` → upload file lên signed URL → `POST /api/resume`; lưu publicId từ response tạo resume.
2. Submit với `estimatedDay` nguyên và số tiền hợp lệ; khóa submit trong khi request chạy.
3. Sau apply thành công, refresh lịch sử, lấy `jobApplicantPublicId` theo `jobPublicId`, hiển thị status PENDING.
4. Nếu cần AI matching, gọi riêng `POST /api/applicant-evaluation` với `{ jobPublicId, resumePublicId }` sau khi ingestion resume hoàn tất. Đây là API ngoài module job; apply không tự kích hoạt evaluation.
5. Dùng `estimatedDays` trong response lịch sử. Không gán nhãn “chưa chấm” chỉ vì matchingScore bằng 0.

### Company xử lý ứng viên

1. Cần dữ liệu ứng viên và `jobApplicantPublicId` từ nguồn được backend cung cấp; `/api/job/applied` chỉ là lịch sử của chính người gọi.
2. Chỉ hiển thị nút theo bảng chuyển trạng thái. Accept tác động đến các hồ sơ PENDING khác, nên UI cần trình bày rõ hiệu ứng này.
3. Refresh dữ liệu liên quan sau mutation; khi conflict cần dữ liệu mới trước khi quyết định lại.

### Các API chưa có trong module hiện tại

- `GET /api/job/:jobPublicId`: chưa đăng ký route. Có `JobDetailResponseDto` và repository `getJobDetails`, nhưng chưa được expose thành HTTP API.
- Danh sách job do company hiện tại đăng, bao gồm CLOSED: chưa có route.
- Danh sách ứng viên của job cho company: chưa có route.
- Xóa job, rút hồ sơ ứng tuyển, sửa hồ sơ ứng tuyển: chưa có route.
- Filter location/arrangement/status/currency, đổi sort, sửa skills/category/arrangement/currency: chưa được hỗ trợ bởi các DTO HTTP hiện tại.

FE agent cần ghi nhận các phần này là phụ thuộc backend trước khi triển khai đầy đủ các màn tương ứng; không tự tạo URL dựa trên tên DTO hoặc method repository.

## 13. Nguồn đối chiếu trong repository

- [Job controller](../../src/modules/job/api/job.controller.ts) và controllers reference data trong cùng thư mục.
- [Request DTO](../../src/modules/job/application/dtos/job.request.dto.ts), [response DTO](../../src/modules/job/application/dtos/job.response.dto.ts).
- [Job service](../../src/modules/job/application/services/job.service.ts), [application service](../../src/modules/job/application/services/job-applicant.service.ts).
- [Job repository](../../src/modules/job/infrastructure/job.repo.ts), [application repository](../../src/modules/job/infrastructure/job-applicant.repo.ts).
- [Job domain](../../src/modules/job/domain/entities/job.entity.ts), [status transitions](../../src/modules/job/domain/value-objects/job-applicant-status-transition.ts).
- [Pagination](../../src/shared/common/pagination.ts), [enums](../../src/shared/domain/enum.ts), [exchange-rate convention](../../src/shared/common/exchange-rate.ts).
- [Exception filter](../../src/shared/common/exceptions.filter.ts), [HTTP error mapper](../../src/shared/common/app-error.mapper.ts), [bootstrap/CORS](../../src/main.ts), [Prisma job models](../../prisma/models/job.prisma).
