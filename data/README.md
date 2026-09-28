# 数据文件说明

本项目当前不使用 MySQL、PostgreSQL 等关系型数据库。运行时数据由服务端以 JSON 文件原子写入 `data/`：

- `content-workspace.json`：创作对象、选题、简报、渠道文案、图片结果和创作记录。
- `publishing-jobs.json`：发布任务、执行进度和人工核验状态。
- `private-inbox.json`：云手机关联账号、私信会话和聊天消息。

真实运行文件已被 `.gitignore` 排除，不能提交到代码仓库。`examples/` 只提供不含真实账号、客户、文案和任务信息的结构样例。首次启动时文件可以不存在，服务端会在首次写入时自动创建。

生产服务器默认目录：`/home/peipei/ideact/data/`。备份时应同时保存该目录、项目 `.env` 和 `public/generated-images/`，恢复时保持文件属主为运行服务的系统用户，并将 `.env` 权限设为 `600`。
