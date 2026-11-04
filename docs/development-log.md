# 开发记录

2026 年 11 月 5 日开始将已有开发成果分批导入 SparkShark。提交时间为实际导入时间，以下记录为已有功能的整理。

## 第 1 批

Reconstruct the existing browser-only version from reviewed pre-cloud backups. Preserve licensed fonts, fictional fixtures, local history and import/export source.

验证：Imported existing tested local implementation; reconstruction typecheck recorded separately.

## 第 2 批

Add visitor registration, scrypt password authentication, private cloud resumes, default quota 10, administrator management, account isolation and local/cloud selection. Include the shared API, D1 adapter tests and lossless Cloudflare font asset stage.

验证：Prior complete local frontend: 155 tests and build; original workerd/D1: 15 integration tests. Imported snapshot typecheck recorded separately.

## 第 3 批

Add the independently threaded Node 24 SQLite backend, deployment build and HTTP integration tests for reuse on an existing server.

验证：Prior Node validation: 11 unit tests and 19 HTTP integration tests, including repeated maximum-size photos. Imported snapshot typecheck recorded separately.
