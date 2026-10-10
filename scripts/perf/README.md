# Seed và đo baseline job search / cache skills

CLI dùng dependencies hiện có; không sửa Prisma schema/index hoặc REST contract,
không thêm cache kết quả search. Seeder không gọi storage, queue hay Gemini và
không tự chạy migration. Dữ liệu mới mang UUID ổn định từ namespace `perf:v1`.

## Development

Chỉ chạy khi PostgreSQL/Redis của Fitwork đã sẵn sàng. Giữ nguyên dữ liệu hiện có.
Chọn DB rõ ràng bằng biến bắt buộc; không có fallback sang `DATABASE_URL`:

```sh
export PERF_DATABASE_URL='postgresql://<user>:<password>@localhost:<port>/<development-db>'
npm run seed:perf -- --jobs 50000
```

Seeder tái sử dụng demo seed để bổ sung reference data, company/applicant/resume
còn thiếu. Dữ liệu demo được cộng thêm ngoài 50.000 job / 50.000 **job_applicant**
benchmark (không phải 50.000 resume). Có 40.000 job một hồ sơ, 1.000 job mười hồ sơ,
9.000 job không hồ sơ; hồ sơ dùng 50 applicant/resume demo với ownership đúng.
Mỗi khối 50 job có 40/1/9 job tương ứng, nên tăng `--jobs` vẫn giữ ID và ownership.
Phân bố 80% OPEN, 20% CLOSED; 3–5 skills khác nhau, VND/USD và dữ liệu ngày/budget
đa dạng. Category và skills có nhóm phổ biến/hiếm. Giá USD dùng tỷ giá cố định của
ứng dụng (25.000 VND/USD), không gọi dịch vụ tỷ giá.

Mỗi batch 1.000 job là một transaction. Chạy lại bổ sung job/hồ sơ thiếu; không
update dòng đã có hoặc khôi phục skills đã bị người dùng xóa. Ownership/identity
conflict sẽ dừng thay vì ghi đè. Nếu batch lỗi, các batch trước đã commit vẫn còn;
chạy lại cùng lệnh để tiếp tục. Chỉ số actual có thể khác phân bố dự kiến nếu dữ
liệu benchmark đã được chỉnh sửa. Không chạy đồng thời hai seeder trên cùng DB.

Sau seed, `ANALYZE job`, `job_skill`, `job_applicant` cập nhật thống kê.
`.tmp/job-benchmark/manifest.json` lưu reference IDs, query mẫu, số tạo mới/đã có,
phân bố thực tế, tổng DB, phiên bản PostgreSQL, fingerprint và `pg_indexes`.
`--manifest <path>` chọn vị trí khác.

## API và JWT

Benchmark cần `API_BASE_URL`, `ACCESS_TOKEN`, `API_DATABASE_URL` (lấy từ cấu hình
**process API thực tế**) và `PERF_DATABASE_URL`. API phải dùng cùng DB và Redis
với benchmark. Token mặc định 15 phút không đủ cho ma trận mặc định ~23 phút;
API development nên đặt `JWT_ACCESS_EXPIRES_IN_SECONDS=3600` rồi login lại.
Token không được ghi vào báo cáo.

Có thể chạy API hiện tại với telemetry Prometheus sẵn có, hoặc dùng launcher riêng
trên port không trùng container khác:

```sh
# Terminal 1, DATABASE_URL/REDIS_URL/CACHE_TTL/JWT_SECRET và các biến app khác từ .env.
export DATABASE_URL="$PERF_DATABASE_URL"
export PORT=3010
export JWT_ACCESS_EXPIRES_IN_SECONDS=3600
export CACHE_METRICS_FILE="$PWD/.tmp/job-benchmark/cache-metrics.json"
npm run bench:api
```

`bench:api` dùng AppModule thật với controller/guard/service/repository/cache adapter
thật, ghi counter ứng dụng mỗi giây vào file và ghi `api-evidence.json` với DB
fingerprint, Redis fingerprint và PID. Launcher không xuất auto traces/logs qua
OTLP. Ghi rõ chế độ telemetry này khi so sánh với API deployment đầy đủ.
Không dùng launcher trên production; AppModule vẫn khởi tạo worker như API bình thường.

Login bằng tài khoản demo `applicant01@seed.fitwork.test`, mật khẩu mặc định
`FitworkDemo@123` hoặc `SEED_PASSWORD` đã dùng khi tạo mới. Seed không đổi mật khẩu
của tài khoản đã có. Lấy `accessToken` từ `POST /api/auth/login`.

```sh
# Terminal 2, export lại các biến cần thiết trong terminal này.
export API_BASE_URL='http://127.0.0.1:3010'
export API_DATABASE_URL="$PERF_DATABASE_URL"
export ACCESS_TOKEN='<accessToken từ login>'
export CACHE_METRICS_FILE="$PWD/.tmp/job-benchmark/cache-metrics.json"
# REDIS_URL và CACHE_TTL phải khớp API; CLI cũng đọc .env.
npm run bench:job -- --manifest .tmp/job-benchmark/manifest.json
```

Nếu dùng API đang chạy với Prometheus, bỏ `CACHE_METRICS_FILE` và đặt
`PROMETHEUS_URL=http://127.0.0.1:9090`, `PROMETHEUS_SERVICE=fitwork-nestjs-api`.
Bảo đảm counter `fitwork_cache_accesses_total{cache_group="reference_skills"}` chỉ
thuộc API được đo và không có client khác gọi skills trong lúc đo. Với API bên
ngoài launcher, URL DB là attestation cấu hình do người chạy cung cấp; CLI đối
chiếu identity DB, sentinel và từng trang query với repository thật, không có
endpoint mới để tiết lộ cấu hình DB. Nếu role không đọc được `pg_control_system`,
fingerprint dùng DB/schema OID, địa chỉ/port server và phiên bản PostgreSQL.

## Kết quả và phương pháp

Mặc định pageSize 20, concurrency cố định 1, 10, 50; warm-up 5 giây và đo 30 giây
cho từng cặp scenario/concurrency. Có 12 scenario: trang đầu; title phổ biến,
hiếm, rỗng; category phổ biến/hiếm; một skill/nhiều skills (OR); budget VND;
tổ hợp filter; trang 100/1.000. Đây là tải closed-loop, không suy ra công suất
cực đại hoặc đặt latency pass/fail khi chưa có SLA.

JSON/Markdown có timestamp tại `.tmp/job-benchmark/baseline-*.{json,md}`. CLI lưu
kết quả từng case, ghi rõ run incomplete nếu lỗi/401/token hết hạn. p50/p95/p99
chỉ gồm request HTTP thành công; warm-up và lỗi không vào percentile. Throughput
thành công chia cho thời gian thực tế, gồm drain request cuối; timeout và lỗi
HTTP/transport được ghi riêng. Preflight so trang API/repository ngoài thời gian đo.

SQL lấy từ query event của **JobRepository.getListJobs** thật, gồm list, count,
query quan hệ. `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` chạy riêng sau ma trận HTTP;
không ép index, đổi planner hay xóa PostgreSQL buffer cache. JSON chứa SQL/params,
full plan, estimated/actual rows/loops, scans, sorts và buffer usage. Thời gian
EXPLAIN không cộng vào latency HTTP. Buffer parent bao gồm child; không cộng các
node để tính tổng. Đây là baseline đã warm-up, không phải database cold-cache.

Skills miss mặc định 100 mẫu tuần tự: xóa **chỉ logical key skills** qua cùng
Keyv/cache-manager/RedisApplicationCache adapter, xác nhận absent, rồi đo HTTP
(không tính thời gian xóa). Hit warm một request rồi chạy ma trận concurrency
như search. Payload miss/hit phải giống; delta metric phải khớp số request gồm
warm-up khi không có lỗi. Request HTTP lỗi/timeout có thể đã đọc Redis; báo cáo
ghi khoảng expected từ số thành công đến số đã thử và lưu kết quả từng phần
khi đối chiếu metric/token thất bại. Cache metric export có thể đợi tối đa 45 giây (`CACHE_METRICS_WAIT_MS`).
Redis miss không chứng minh DB lạnh; không gán latency search cho cache skills.

Có thể smoke nhanh khi DB sẵn sàng:

```sh
npm run bench:job -- --duration 1 --warmup 0.2 --concurrency 1 --cache-miss-samples 3
```

Tùy chọn khác: `--page-size`, `--timeout` (giây), `--output`. Smoke không thay thế
baseline mặc định. So p95 theo tải, deep pagination, SQL list/count/relations,
row-estimate sai lệch, scan/sort và buffer/temp writes trước khi đề xuất index,
keyset pagination, pool tuning hoặc search cache trong thí nghiệm tiếp theo.

## Kiểm chứng

```sh
npm run test:perf
npm test -- --runInBand
npm run lint
npx eslint scripts/perf test/perf.e2e-spec.ts
npm run build
```

`test:perf` kiểm tra toàn bộ 50.000 fixture, ID ổn định, phân bố, skills khác nhau,
conversion, ownership khi tăng dataset, warm-up/error/timeout và token expiry.
Test DB opt-in, không xóa dữ liệu, yêu cầu DB rỗng riêng có tên chứa `test` và đã
migrate schema. Không trỏ test vào DB development:

```sh
export PERF_TEST_DATABASE_URL='postgresql://<user>:<password>@localhost:<port>/fitwork_perf_test'
# Chuẩn bị schema riêng, chỉ trong DB test này:
DATABASE_URL="$PERF_TEST_DATABASE_URL" npx prisma migrate deploy
npm run test:perf
```

Test tích hợp dùng 100 job: batch lỗi bởi trigger, rollback/resume, seed hai lần,
giữ chỉnh sửa, ownership SQL join, OPEN/filter/budget/page/count hồ sơ hoạt động,
capture và EXPLAIN SQL thật. Có thêm regression truy vấn sentinel với 50.000 IDs
bằng một array parameter để tránh giới hạn bind PostgreSQL/Prisma. Chạy lại suite
với một DB test rỗng khác vì suite không dọn dữ liệu. Khi không có
`PERF_TEST_DATABASE_URL`, năm test DB được skip.

## k6 job search trước/sau index

### Applicant login + search: 300/500 VUs

Với server đã chạy bằng `.env` hiện tại, dùng:

```sh
npm run bench:applicant:k6 -- --smoke --label applicant-smoke
npm run bench:applicant:k6 -- --label applicant-before-index
# Chỉ một mức tải nếu muốn:
npm run bench:applicant:k6 -- --vus 500 --label applicant-500
```

Profile applicant cần **k6 >= 1.5** (đã kiểm chứng với 2.0.0). Runner hiện banner,
tiến độ VUs/iterations và **summary gốc của k6 ngay trên terminal** cho từng mức
tải; vẫn lưu đầy đủ artifacts/report. Xem **`job_search_measured`** để lấy latency
search HTTP 200 hợp lệ bắt đầu sau warm-up. Bảng HTTP chung của k6 vẫn gồm login
setup, search warm-up và lỗi; `job_search_sample` gồm cả search warm-up/lỗi.
Throughput search chính xác, loại thời gian login setup, nằm trong report tổng hợp.

Nếu muốn tự chạy bằng lệnh `k6 run`, chuẩn bị một mức tải trước:

```sh
npm run bench:applicant:k6 -- --prepare-only --vus 500 --label direct-500
export K6_APPLICANT_PASSWORD='<mật khẩu seed đã dùng>'
# Copy nguyên lệnh K6_CONFIG=... K6_APPLICANT_ACCOUNTS_FILE=... k6 run ...
# mà bước prepare in ra terminal, rồi chạy trong cùng terminal.
```

Với seed mặc định, mật khẩu demo là `FitworkDemo@123`; nếu đã dùng mật khẩu khác,
dùng đúng `K6_APPLICANT_PASSWORD`/`SEED_PASSWORD`. Không cần access token.
`--prepare-only` vẫn kiểm tra DB/API và có thể tạo account còn thiếu; nó không
phát workload hay chạy EXPLAIN. Thêm `--smoke` để chuẩn bị lượt 2 VUs/24 search.
Account JSON chỉ chứa email/publicId, config chứa query/payload mong đợi; password
không được lưu vào file. k6 đọc password từ environment, login hết account trong
setup rồi mới warm-up và đo search. Chạy các lệnh được in tuần tự nếu chuẩn bị cả
300/500 VUs. Giữ `--new-machine-readable-summary` trong lệnh khi export summary:
format cũ có `setup_data` chứa token phiên; format mới bỏ dữ liệu này.

Lượt `k6 run` trực tiếp xuất summary/metrics và hiện kết quả trên terminal; nó
không tạo báo cáo tổng hợp, so baseline, chạy SQL EXPLAIN hoặc kiểm tra dữ liệu
sau tải như runner. Chạy prepare lại nếu dữ liệu/API đổi trước khi phát tải.

Profile `applicant` tự đọc `.env` giống server, dùng `PERF_DATABASE_URL` hoặc
`DATABASE_URL`; `API_DATABASE_URL` mặc định `DATABASE_URL` hoặc DB đã chọn.
API mặc định `http://127.0.0.1:$PORT` (PORT mặc định 3000). Nếu server có cấu hình
khác `.env`, export `API_BASE_URL`, `PERF_DATABASE_URL`, `API_DATABASE_URL` thực tế.
Không cần `ACCESS_TOKEN`: Node login một account cho preflight; k6 setup login
tất cả account riêng bằng `POST /api/auth/login` trước khi VUs search.

Runner query các account thuộc `@seed.fitwork.test`/`@perf.fitwork.test`, chỉ dùng
applicant active, đúng role, có profile và bcrypt khớp mật khẩu đã biết. Mật khẩu
lấy từ `K6_APPLICANT_PASSWORD`, rồi `SEED_PASSWORD`, rồi default demo seed.
DB chỉ lưu hash; không thể đọc lại mật khẩu gốc của account người dùng bất kỳ.
Thiếu account thì tự tạo **chỉ số còn thiếu** trong namespace k6, cùng applicant
profile, trong một transaction. Tài khoản/mật khẩu cũ không bị update/reset.
`--no-seed-accounts` sẽ báo thiếu và dừng thay vì tạo mới. Chạy lại tái sử dụng
pool hiện có. Không seed lại job hoặc đổi query/index/cache.

Setup login theo batch tối đa 10 request đồng thời, chờ đủ toàn bộ account thành
công rồi mới bắt đầu search. Login lỗi hoặc token không đủ hạn cho toàn workload
sẽ dừng trước search. Setup timeout 10 phút; không login lại trong warm-up/đo.
Mỗi VU gắn với một account riêng và giữ token trong memory, search luân phiên 12
query từ manifest. Nghỉ 1/2/3s xác định giữa các lượt để mô phỏng thời gian đọc/tìm
kiếm. Mặc định chạy tuần tự **300 VUs rồi 500 VUs**, mỗi mức warm-up search 10s,
đo 60s, `constant-vus`, timeout/graceful stop 10s. Full khoảng 3 phút cộng
preflight/login setup/SQL. `--vus 300,500` chọn các mức 1..500 (không trùng).

Smoke login đủ 2 account trước, rồi 2 VUs thực hiện mỗi VU 12 search, không nghỉ
để kiểm tra đủ query/session nhanh. Report tách p50/p95/p99 và lỗi của **login**
khỏi search; login metrics thuộc setup riêng, không bao gồm thời gian search.
`authenticatedVus` là số phiên applicant login thành công
với danh tính riêng; target của profile này là VUs, không phải request/s cố định.
Thời gian nghĩ và final iteration drain được tính vào mẫu số throughput, không
vào latency HTTP search. Thời gian login setup không vào mẫu số throughput
search. Không coi 500 VUs tương đương 500 request/s.

Password/account list truyền qua child env, token chỉ giữ trong memory; artifacts
không chứa password, JWT, refresh cookie hoặc password hash. Báo cáo chỉ ghi số
account tạo/tái sử dụng và identity hash để giữ cùng pool khi so trước/sau. Login
thật có tạo refresh-token records như API bình thường; không xóa các records này
bằng SQL. Tạo baseline mới với cách đo login-trước-search; không so với report cũ
có login/search chồng nhau vì workload hash khác. So index bằng cùng
profile/VUs/pool/dataset/server:

```sh
npm run bench:applicant:k6 -- --label applicant-after-index \
  --baseline .tmp/job-benchmark/k6/<applicant-before-index-run>/report.json
```

### Baseline search dùng token có sẵn

Runner mới chỉ gọi job search; không seed, khởi động API, login, migration,
ANALYZE hay đổi DB/cache/index. Cài `k6 >= 0.57` trên PATH (đã kiểm chứng với
k6 2.0.0). Script chỉ import module tích hợp k6 và helper TypeScript cục bộ.
Runner nhận **bốn biến qua môi trường**, không đọc `.env` hoặc fallback:
`API_BASE_URL`, `ACCESS_TOKEN`, `PERF_DATABASE_URL`, `API_DATABASE_URL`.
`API_DATABASE_URL` phải lấy từ cấu hình process API thực tế. Không gửi URL DB
hoặc token vào command arguments/artifacts; token chỉ truyền cho child qua env.

```sh
# API đã chạy, DB đã seed 50.000 job; export bốn biến ở phần API/JWT phía trên.
npm run bench:job:k6 -- --smoke --label smoke
npm run bench:job:k6 -- --profile all --label before-index
# Sau khi thêm index, giữ nguyên workload, dữ liệu và môi trường:
npm run bench:job:k6 -- --profile all --label after-index \
  --baseline .tmp/job-benchmark/k6/<before-index-run>/report.json
```

`--profile all|matrix|mixed|applicant` mặc định `all`; `--manifest` mặc định
`.tmp/job-benchmark/manifest.json`; `--output` là thư mục cha, mặc định
`.tmp/job-benchmark/k6/`. Mỗi lượt tạo thư mục riêng có label/timestamp chứa
`report.json`, `report.md`, config, raw metrics JSONL, summary và log đã che
secrets từng case. Các file trong `.tmp/` không được Git track.

Matrix: lần lượt 12 tiêu chí × 1/10/50 VUs, `constant-vus`, warm-up 5s + đo 30s,
mỗi iteration một request, không sleep. Mixed: lần lượt 25/50/100 request/s,
`constant-arrival-rate`, warm-up 10s + đo 60s, cấp sẵn/tối đa 100 VUs;
`scenario.iterationInTest % 12` chia đều các iteration **đã bắt đầu**. Dropped
iterations không có criterion vì request chưa phát. Warm-up phân loại theo
thời điểm bắt đầu request; cả request đi qua ranh giới vẫn thuộc warm-up.
Timeout và graceful stop 10s. Runner đợi process trước kết thúc (gồm drain) rồi
mới khởi động case tiếp theo; matrix và mixed không chồng nhau. Smoke dùng
`shared-iterations`: một request với 1 VU cho mỗi tiêu chí; mixed warm-up 1s,
đo 2s ở 25 request/s. Smoke có workload hash khác full run.

Full `all` khoảng 31 phút gồm ngân sách drain, cộng startup/preflight/SQL;
token cần đủ thời hạn cho toàn HTTP workload. Token 15 phút không đủ. Runner
kiểm tra JWT expiry lúc đầu và trước mỗi case; JWT thiếu expiry bị từ chối.
Preflight xác nhận identity/counts với manifest và DB API, đủ 50.000 UUID seed,
sentinel API, toàn bộ payload từng query với `JobRepository.getListJobs` thật.
API sai DB/filter/payload sẽ dừng trước workload. Đây vẫn là attestation cấu hình
API do người chạy cung cấp, không phải endpoint tiết lộ cấu hình API.

Percentile p50/p95/p99 chỉ lấy `response.timings.duration` của HTTP 200 có
payload hợp lệ/khớp repository, loại warm-up và request lỗi. Duration gồm
sending/waiting/receiving, loại blocked/connect/TLS; không coi tương đương tuyệt
đối với timer end-to-end Node cũ. Throughput thành công và request phát/s chia
cho khoảng đo thực tế **gồm drain**; target arrival rate áp dụng khoảng phát tải
cấu hình. Report ghi tổng/từng criterion, issued/completed/unfinished, timeout,
transport, HTTP status, payload/check failures, target/achieved rate, VUs và
dropped iterations. K6 summary/raw chứa warm-up; dùng report tổng hợp để so đo.
Không đặt SLA latency hoặc suy ra công suất tối đa/traffic production.

HTTP 401/403 abort k6 và dừng các case còn lại; lỗi khác vẫn được thống kê.
SIGINT/SIGTERM lưu phần đã đo và giữ artifact từng case trước. Exit 1 nếu run
incomplete, lỗi/check failure, không đạt tải hoặc comparison bị chặn. Dropped
iterations (đo hoặc warm-up) đánh dấu không đạt tải; error warm-up cũng khiến
kiểm chứng thất bại. SQL capture và EXPLAIN tái sử dụng helper cũ, chỉ chạy sau
tất cả HTTP, ngoài khoảng đo.

Report ghi workload SHA-256 (query, thứ tự, tải, thời gian, script/helper), Node/k6/
PostgreSQL, commit/dirty state, DB counts và index thực tế. Hash nội dung sáu bảng
job/job_skill/job_applicant/category/skill/arrangement trước/sau phát hiện thay
đổi dữ liệu kể cả UPDATE không đổi count. Comparison chặn workload/data/count/
DB identity khác hoặc run incomplete, cho phép index khác và ghi diff. Bảng
delta p95/p99/throughput ghép theo case/mức tải và criterion mixed. Kiểm tra cờ
verified/targetLoadMet của cả hai lượt trước khi diễn giải delta; giữ cùng API,
telemetry, host và cấu hình pool. Không đổi query cùng lúc với thí nghiệm index.

```sh
npm run test:perf
npm run build
npx eslint scripts/perf/k6*.ts scripts/perf/k6/workload.ts
```

`test:perf` chạy smoke bằng binary k6 thật trên HTTP fixture cục bộ khi có k6,
kiểm tra 12 case + mixed, metrics/timeout/transport/malformed/500/401 và secrets
trong artifacts. Fixture chỉ kiểm chứng harness; không phải baseline API/DB thật.
Có thêm test account eligibility/password hash, create-only/idempotency, identity
JWT, mỗi VU login một lần rồi reuse token, 300/500 VUs thật trên fixture và lỗi
login 401 không vào search latency.
Khi không có k6, hai test binary skip rõ ràng. Unit còn kiểm tra serialization,
schedule/drain, phân phối mixed, percentile/throughput, JWT, comparison/index diff
và preflight sai DB/filter/payload. Baseline thật chỉ chạy khi bốn biến hợp lệ.

## Trạng thái thực thi của phiên triển khai

Đã chạy development ngày 10/10/2026 sau khi người dùng báo DB sẵn sàng:

- Đủ 50.000 job benchmark và 50.000 hồ sơ; chạy lại tạo 0 dòng mới.
- Tổng DB 50.060 job / 50.151 hồ sơ, giữ dữ liệu có trước; kiểm tra 0 lỗi ownership.
- 36 lượt search và 72 SQL/EXPLAIN hoàn tất, 0 lỗi/timeout. Cache: 100 miss và
  hit ở concurrency 1/10/50; payload giống nhau, metric khớp, 0 lỗi Redis.
- Test perf trên DB test riêng: 4 suites / 19 tests pass. Unit: 500 tests pass;
  build/lint pass. Full test typecheck còn 13 diagnostic cũ, không có lỗi mới.

Báo cáo điểm nghẽn và bước tối ưu tiếp theo:
[results.md](../../.tmp/job-benchmark/results.md). Dữ liệu chi tiết:
[manifest](../../.tmp/job-benchmark/manifest.json),
[baseline JSON](../../.tmp/job-benchmark/baseline-2026-10-09T17-09-54-118Z.json),
[baseline Markdown](../../.tmp/job-benchmark/baseline-2026-10-09T17-09-54-118Z.md).
Artifacts trong `.tmp/` không được Git track; giữ hoặc sao chép trước khi dọn workspace.
Đây là baseline development dùng chung host, không suy ra công suất tối đa.
