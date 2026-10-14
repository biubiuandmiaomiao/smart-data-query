# 智能取数 · 跨设备运行包

打包日期：2026-10-10。包含当前项目代码、运行依赖、Windows x64 Node.js 22.23.2、启动脚本和测试。只连接 `d_root_project_marketing_db`。

## Windows：解压后双击启动

1. 将整个 ZIP **先解压**到可写目录，例如 `D:\MarketingDictionary`。不要直接在压缩包内运行，也不要只拷贝 start.cmd。
2. 双击 **start.cmd**。不必安装 Node.js、npm 或下载依赖。启动时自动创建空白 `.env`，并打开浏览器。
3. 若浏览器未自动打开，访问 **http://127.0.0.1:4173/?view=metrics**。保持启动窗口开启，关闭窗口或按 Ctrl+C 会停止服务。
4. 初次可以打开界面及7个内置指标。要查看真实字段、样例和统计结果，需要按下一节配置数据库。

支持 Windows 10/11 x64。Windows ARM、Mac、Linux 不使用附带的 x64 node.exe，安装适配设备的 Node.js 22或更高版本后，用下方命令启动。

## 接通营销库和模型

使用记事本或代码编辑器打开根目录 `.env`，只修改等号后的值：

```dotenv
PORT=4173
DB_HOST=数据库地址
DB_PORT=3306
DB_USER=营销库只读账号
DB_PASSWORD="数据库密码"
DB_NAME=d_root_project_marketing_db
DEEPSEEK_API_KEY=
```

密码含 `#` 等字符时必须保留双引号；若密码含引号，请按 dotenv 格式选择合适的引号包裹。修改配置后重启服务。数据库名称由服务端固定，改 DB_NAME 不能切换到其他库。

新电脑需要能访问数据库网络：办公网/VPN、RDS来源IP白名单或防火墙按实际环境配置；账号须具备营销库及所用表的 SELECT 权限。项目使用 MySQL 8.0 能力（快照查询含窗口函数）。**带代码并不等于自动获得数据库网络和权限。**

模型在网页“连接与模型”中填写地址、模型和 API Key，再点测试连接。也可在 `.env` 填写 DEEPSEEK_API_KEY。模型未配置不影响手动选择指标、维护字段和数据库查询，但自动问数与模型解释不可用。

**check.cmd** 可检查环境、目录写权限和营销库连通性；不输出密码和模型密钥。配置完成后，在页面选择一个指标，选有数据的日期，先“仅试跑开始日”，确认新设备的实际查询链路。

## Mac / Linux / 已安装 Node 的设备

安装对应系统/架构的 Node.js 22或更高版本，然后在解压目录运行：

```sh
sh start.sh
# 或
node scripts/start.mjs
```

运行依赖已包含，当前依赖中没有原生 `.node` 二进制，正常启动无需执行 npm install。打开终端显示的地址。启动脚本自动把工作目录切到项目根目录，路径含中文、空格也可使用。建议解压路径尽量短，避免Windows旧式路径长度限制。

Windows ARM 可在安装原生 Node 后运行 `node scripts/start.mjs`。本次实际验证环境为 Windows x64；未在实体 Mac/Linux/ARM 设备运行，不能将跨平台脚本视为所有设备的实测承诺。

## 本地数据与迁移

- 首次运行创建 `.data/workspace.json`，保存字段“再注释”、代码释义、确认状态、指标、常用、已保存分析和模型设置。
- 本包不包含原电脑的 `.env`、`.data`、数据库密码、模型密钥、查询结果或测试截图。启动后是7个内置指标的干净工作区，不会带上旧设备的私人配置。
- 用户维护的业务注解保存成功后在本机重启仍保留。换目录时保留 `.data` 即可；修改数据库配置要编辑新目录的 `.env`。
- 若确实需要搬迁原工作区，先停止两端服务，备份目标 `.data`，再单独迁移来源 `.data/workspace.json`。文件可能包含模型密钥和内部业务解释，应通过受控方式传输，不要混入可公开分享的代码包。已有样例确认凭据不会迁移，需重新查看样例。
- `.env` 可用 DATA_DIR 指定状态目录，推荐绝对路径。不设置时默认使用本项目 `.data`。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 端口被占用 | 编辑 .env，把 PORT 改为4175等空闲端口，重启后使用新地址 |
| 网页能开，数据库未配置 | 填好 .env 并重启；不会用模拟值替代实际数据 |
| 数据库超时 / 拒绝连接 | 检查地址、3306端口、VPN、IP白名单及防火墙 |
| Access denied | 核对账号密码和营销库读取权限 |
| Node或依赖缺失 | 完整解压；Windows保留 runtime 和 node_modules；其他系统安装Node |
| 无法创建 .env 或 .data | 解压到当前用户有写权限的普通目录 |
| 某字段/表不存在 | 新设备连接的营销库需包含相同表结构；在页面同步字段后核对 |
| 别的电脑打不开当前电脑的地址 | 服务只监听本机，每台设备各自启动；此包不是共享服务器部署 |

## 验证与开发

Windows双击 test.cmd，或运行 `node scripts/test.mjs`，执行隔离的单元/API测试，不依赖业务数据库和模型。

浏览器回归属于开发验收，先执行 npm ci 安装开发依赖（包内未附带 Playwright Core）；需要另起隔离工作区服务、配置数据库/模型及可用日期，可用 BROWSER_EXECUTABLE 指定 Chrome/Edge 可执行文件路径。不要把会修改字段释义的测试指向正式工作区。

根目录 package-lock.json 固定依赖版本。重新安装时执行 `npm ci`，只要运行依赖可执行 `npm ci --omit=dev`；需网络，完整开发安装会包含 Playwright Core，但不自动提供浏览器。

源码结构：server 为API与查询逻辑，public 为界面，test 为测试，scripts 为便携启动/自检。详细功能说明见 docs/DEVELOPMENT.md，历史验收见 docs/USER_JOURNEY_AUDIT.md。本包不意味着后续方案中规划的功能已开发完成。

Windows运行时许可证位于 runtime/win-x64/LICENSE，各依赖许可证保留在 node_modules 各包内。发布清单见 RELEASE-MANIFEST.json，当前打包验证见 PACKAGE-VERIFICATION.md。
