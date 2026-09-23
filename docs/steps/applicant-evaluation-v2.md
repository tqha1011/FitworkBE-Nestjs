# Các bước tiếp theo cho Applicant Evaluation V2

> Kế hoạch thực hiện theo từng chặng nhỏ. Chỉ đánh dấu một chặng hoàn tất sau khi chạy đúng lệnh kiểm tra và xem kết quả. Dùng luồng API → BullMQ → processor hiện có; V1 đã lưu vẫn đọc được.

**Mục tiêu:** Từ một job có skills đã chọn và một CV giả, trả về kết quả cho từng skill kèm câu dẫn chứng có thật trong CV. Kết quả giúp người tuyển dụng xem xét, không tự đổi trạng thái ứng viên.

**Kiến trúc:** Mỗi evaluation giữ bản job snapshot và CV đã xử lý của chính nó. Gemini chỉ đề xuất verdict, điểm cho từng criterion và dẫn chứng; backend xác minh dẫn chứng, tính điểm cuối rồi mới lưu. `requirements` vẫn là string để hiển thị và làm ngữ cảnh; chưa tự tách nó thành các criterion.

**Công nghệ:** NestJS, Prisma, BullMQ, Gemini, Ajv, Jest.

**Nguồn yêu cầu:** Scope Evaluation V2 trong hội thoại và scaffold hiện tại tại `docs/superpowers/plans/2026-09-23-evaluation-criteria-scaffold.md`. Tài liệu này ưu tiên một bản có thể demo cho project xin intern.

## Trạng thái hiện tại

- Đã có `JobSnapshotV2.criteria` từ `jobSnapshot.skills`, ví dụ `skill:1`; `requirements` được giữ nguyên. Job không chọn skill tiếp tục dùng snapshot V1.
- `EvaluationEvidenceV2` mới có TypeScript type. Prompt, Gemini response schema, validator, mapper, API và processor vẫn xử lý kết quả V1.
- `ApplicantEvaluation` lưu hash và version, nhưng job snapshot và con trỏ `resumeContent` đang nằm trên `JobApplicant`. Lần prepare sau có thể ghi đè dữ liệu mà evaluation cũ đang chờ đọc.
- API `GET /api/applicant-evaluation/:evaluationPublicId` hiện dành cho applicant. Luồng accept/reject đã có hành động riêng của người dùng ở module job.

## Quy tắc chung

- Không tạo bảng `JobCriterion`: criteria là một phần của job snapshot JSON. Bảng mới chỉ cần khi recruiter có chức năng sửa hoặc tái sử dụng criteria.
- Không `split(',')` trên `requirements`: dấu phẩy trong câu tự do không xác định được ranh giới yêu cầu.
- Mọi offset của evidence tính trên **đúng chuỗi CV đã gửi Gemini**, không tính trên raw CV. Dùng quy ước `[startOffset, endOffset)` theo chỉ số string JavaScript; bản đầu có thể dùng `section: 'resume'`.
- Không đưa raw CV hoặc nội dung prompt vào log, tên job BullMQ, metrics hay error message.
- V1 đã lưu phải tiếp tục đọc được. Job còn trong queue mang `promptVersion` V1 phải gọi prompt/response schema V1, kể cả khi snapshot đã mang `schemaVersion: 2` từ scaffold hiện tại. Nếu input lịch sử đã bị lần prepare khác ghi đè, không thể tái tạo nó chỉ từ hash; đánh dấu lỗi rõ ràng thay vì chấm trên input mới.
- Chỉ đánh dấu V2 `COMPLETED` sau khi schema, criteria, evidence và điểm số đều hợp lệ. Khi sai, trả lỗi an toàn để BullMQ retry theo chính sách hiện có.

## Các trường hợp dễ lỗi cần có test

1. Hai evaluation của cùng một application với job/CV khác version: evaluation cũ vẫn đọc đúng input của nó.
2. CV chứa email/điện thoại/URL hoặc câu “ignore previous instructions”: nội dung gửi Gemini đã che định danh và output vẫn đúng schema.
3. Gemini trả thiếu criterion, lặp ID hoặc ID lạ: không lưu `COMPLETED`.
4. Snippet bịa, offset âm/quá dài, hoặc snippet không khớp ký tự tại offset: không lưu `COMPLETED`.
5. Evaluation V1 cũ và job không có skill: vẫn đọc/xử lý theo V1.

---

### Bước 1 — Cố định input theo từng evaluation

**File chính:** `prisma/models/job.prisma`, `prisma/models/resume.prisma`, `src/modules/applicant-evaluation/infrastructure/applicant-evaluation.repo.ts`, `src/modules/applicant-evaluation/domain/repositories/applicant-evaluation.repo.interface.ts` và test repository cùng tên `.spec.ts`.

**Giao diện mong muốn:** Mỗi hàng `ApplicantEvaluation` có `jobSnapshot` JSON và `resumeContentId` riêng; `claimForProcessing(evaluationPublicId)` ưu tiên hai trường đó, rồi kiểm tra `jobContentHash`, `resumeContentHash`, `parserVersion`. Với hàng V1 cũ chưa có hai trường này, dùng quan hệ `JobApplicant` hiện tại để đọc tương thích.

- [ ] Viết test: prepare evaluation A, prepare evaluation B cho cùng application, sau đó claim A vẫn nhận snapshot/resume A; hash A hợp lệ.
- [ ] Viết test: bản ghi V1 chưa có trường riêng và hash còn khớp vẫn đọc được; hash không khớp thì fail với thông báo chung, không kèm CV/job text.
- [ ] Thêm trường nullable vào Prisma, migration theo quy trình repo, cập nhật `prepare` để ghi vào bản ghi evaluation lúc tạo. Không ghi đè input của evaluation đã tồn tại khi `upsert` gặp lại cùng key.
- [ ] Đổi `claimForProcessing` sang đọc input của evaluation. Chạy `npx prisma format`, `npx prisma validate`, `npx prisma generate` và test repository.

**Điều kiện đạt:** Tạo evaluation mới không đổi input của evaluation cũ; V1 cũ vẫn đọc được.

### Bước 2 — Tạo CV snapshot gửi LLM

**File chính:** tạo `src/modules/applicant-evaluation/application/services/resume-evaluation-snapshot.ts` và `.spec.ts`; sửa `prisma/models/job.prisma`, repository, processing service, prompt builder.

**Giao diện mong muốn:**

```ts
type ResumeEvaluationSnapshot = {
  text: string;
  hash: string;
  redactionVersion: 'resume-redaction-v1';
};

function createResumeEvaluationSnapshot(
  extractedText: string,
): ResumeEvaluationSnapshot;
```

- [ ] Viết test với CV synthetic chứa email, số điện thoại, profile URL, tên/địa chỉ ở header và kinh nghiệm NestJS. Kết quả phải che định danh nhưng giữ nguyên câu kinh nghiệm.
- [ ] Viết test cho nhiều kiểu xuống dòng, ký tự Unicode và prompt injection nằm trong CV; text không được đưa vào exception/log.
- [ ] Implement hàm normalize/redact có version. Nếu một loại định danh không xử lý đáng tin cậy, ghi rõ giới hạn thay vì tuyên bố đã ẩn danh hoàn toàn.
- [ ] Lưu `redactedResumeText`, `redactedResumeHash`, `redactionVersion` trên evaluation V2. Khi retry, dùng snapshot đã lưu; Gemini chỉ nhận chuỗi này. Chạy test focused và Prisma commands của bước 1.

**Điều kiện đạt:** Input gửi Gemini không có định danh trực tiếp trong fixture; hash khớp chính xác text dùng để kiểm tra evidence.

### Bước 3 — Cho Gemini trả kết quả từng criterion

**File chính:** `src/modules/applicant-evaluation/application/constants/applicant-evaluation.constants.ts`, `src/modules/applicant-evaluation/application/interfaces/applicant-evaluation-llm.interface.ts`, các file `src/modules/applicant-evaluation/infrastructure/llm/applicant-evaluation-{prompt.builder,response.schema,response.validator}.ts`, provider Gemini và các `.spec.ts` tương ứng.

**Output V2 cần có:**

```ts
type EvaluationCriterionResult = {
  criterionId: string;
  criterionText: string;
  verdict: 'MATCHED' | 'PARTIAL' | 'MISSING';
  scoreContribution: number;
  explanation: string;
  evidence: Array<{
    snippet: string;
    section: 'resume';
    startOffset: number;
    endOffset: number;
  }>;
};
```

- [ ] Thêm prompt version V2; system instruction quy định job/CV là dữ liệu, không phải lệnh. User message chỉ chứa criteria, job context cần thiết và CV snapshot đã redact.
- [ ] Thêm JSON response schema V2. Gemini trả một result cho mỗi criterion, không trả `overallScore` để backend tính ở bước 4.
- [ ] Viết test provider/prompt: V2 gọi schema V2; `promptVersion` V1 dùng schema V1 ngay cả với snapshot V2 từ scaffold; câu lệnh giả nằm trong resume không làm thay đổi system instruction.
- [ ] Chạy test prompt/provider và `npm run build`.

**Điều kiện đạt:** Một fixture có hai skill tạo hai criterion result với ID tương ứng; V1 vẫn xử lý như cũ.

### Bước 4 — Xác minh evidence và tính điểm trong backend

**File chính:** tạo `src/modules/applicant-evaluation/application/services/evaluation-v2-validator.ts` và `.spec.ts`; sửa `src/modules/applicant-evaluation/application/services/applicant-evaluation.processing.service.ts`.

**Giao diện mong muốn:**

```ts
function validateEvaluationV2(
  criteria: JobCriterion[],
  resumeText: string,
  output: EvaluationEvidenceV2,
): { evidence: EvaluationEvidenceV2; overallScore: number };
```

- [ ] Viết test cho: đúng/mất/lặp/lạ `criterionId`; `criterionText` bị đổi; verdict không hợp lệ; `MATCHED`/`PARTIAL` có điểm dương nhưng không có evidence; `MISSING` có điểm khác 0.
- [ ] Viết test cho offset âm/quá dài, `resumeText.slice(startOffset, endOffset) !== snippet`, score vượt `weight`, số âm/NaN. Dùng CV Unicode trong một test offset.
- [ ] Implement validator: mỗi criterion xuất hiện đúng một lần; score contribution trong `[0, weight]`; mọi evidence khớp snapshot; `overallScore = Math.round(sum(scoreContribution))` và nằm trong `[0, 100]`.
- [ ] Processor chỉ gọi `markCompleted` sau khi validator trả thành công. Lỗi validation trả thông báo chung để retry, không đính kèm snippet/CV. Chạy focused tests và build.

**Điều kiện đạt:** Output bịa evidence không thể trở thành kết quả `COMPLETED`.

### Bước 5 — Lưu/đọc V2 và demo API

**File chính:** `src/modules/applicant-evaluation/domain/value-objects/evaluation.ts`, `src/modules/applicant-evaluation/domain/repositories/applicant-evaluation.repo.interface.ts`, `src/modules/applicant-evaluation/infrastructure/applicant-evaluation.mapper.ts`, `src/modules/applicant-evaluation/application/dtos/applicant-evaluation.response.dto.ts`, repository/service/controller và các `.spec.ts` tương ứng.

- [ ] Định nghĩa `EvaluationBreakdownV2` từ các criterion contribution đã validate; mapper chọn V1/V2 qua `schemaVersion` của JSON, không ép mọi bản ghi sang V2.
- [ ] Lưu evidence V2, điểm cuối, hash/version metadata; API detail trả `decisionSupportOnly: true` và các criterion đã xác minh.
- [ ] Thêm API đọc cho job owner, kiểm tra `job.postedBy` trước khi trả kết quả. Test owner xem được, người khác bị từ chối, và applicant endpoint cũ vẫn hoạt động.
- [ ] Kiểm tra luồng accept/reject hiện có vẫn do người dùng chủ động gọi; evaluation processor không gọi chuyển trạng thái. Chạy test module, build, lint.

**Điều kiện đạt:** Demo được `job → CV → từng skill MATCHED/PARTIAL/MISSING → snippet trong CV → điểm tổng`. V1 vẫn trả DTO cũ.

### Bước 6 — Bộ fixture và kiểm tra cuối

**File chính:** tạo fixture synthetic dưới `test/fixtures/applicant-evaluation/`; thêm test integration/e2e phù hợp với cấu trúc `test/` của repo.

- [ ] Tạo job có hai skills và CV giả: một skill có bằng chứng, một skill thiếu; thêm email, URL và câu prompt injection. Không dùng CV thật.
- [ ] Thêm output mẫu hợp lệ và output bịa snippet/sai offset; kiểm tra retry rồi `FAILED` theo số lần đã cấu hình.
- [ ] Chạy `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint -- --no-fix` và Prisma validate/generate nếu schema đổi. Ghi kết quả thật vào PR/README demo.

**Mốc dừng hợp lý cho CV intern:** Hoàn tất bước 1–6, demo bằng fixture và giải thích được tại sao backend bác kết quả LLM sai. Chỉ ghi lên CV những phần đã code và test.

## Sau mốc demo

- Tách `requirements: string` thành yêu cầu có cấu trúc khi tạo/sửa job hoặc bổ sung bước LLM extraction có kiểm tra; hiện tại các ý trong chuỗi chưa được chấm riêng.
- Bổ sung feedback/override của recruiter, token usage và metrics tổng hợp theo model/prompt/redaction version.
- Mở rộng redaction cho các định danh phức tạp và đánh giá trên fixture đa ngôn ngữ; không coi regex cơ bản là bảo đảm ẩn danh.
