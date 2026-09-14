# Linux 服务器部署指南

面向 Ubuntu / Debian（CentOS 同理，把 `apt` 换成 `dnf` 即可）。
目标：**Go 抓取代理 + monitor.js + 仪表盘** 三个组件在服务器上常驻并可开机自启。

---

## 0. 组件与端口

| 组件 | 作用 | 端口/文件 |
| --- | --- | --- |
| `douyinLive-linux-amd64` | Go 抓取代理（源码 jwwsjlm/douyinLive），连接抖音直播间 | TCP `1088`，`GET /health` |
| `monitor.js --daemon` | 监控脚本：连代理、落库、通知 | 控制通道 `monitor.sock`、PID `monitor.pid` |
| `web-dashboard.js` | 仪表盘 HTTP + `/api/*` | `9871`（默认只绑 127.0.0.1） |

数据流：`抖音 ⇄ Go 代理(1088) ⇄ monitor.js → SQLite → web-dashboard(9871) → 浏览器`

---

## 1. 准备

```bash
# Node.js 20+（better-sqlite3 需要 20/22/24）
node -v

# 代码放到 /opt/douyin-monitor
sudo mkdir -p /opt/douyin-monitor
sudo chown "$USER":"$USER" /opt/douyin-monitor
cd /opt/douyin-monitor

# 依赖
npm install
```

必须准备两样东西，否则监控起不来（状态页会直接报出来）。

### 1.1 Go 抓取代理二进制

代理源码：`https://github.com/jwwsjlm/douyinLive`（本项目用它的 v2 系列）。
Releases 地址：`https://github.com/jwwsjlm/douyinLive/releases`

```bash
# 服务器（x86_64）
curl -L -o proxy.tar.gz \
  https://github.com/jwwsjlm/douyinLive/releases/download/v2.2.1/douyinLive-v2.2.1-60823bae3f14-linux-amd64.tar.gz
tar -xzf proxy.tar.gz
chmod +x douyinLive
mv douyinLive douyinLive-linux-amd64

# 验证能跑
./douyinLive-linux-amd64 --version
# 期望输出：tag=v2.2.1 commit=60823bae3f14 ... signProvider=local

# 起一下看是否监听 1088，并访问 /health
./douyinLive-linux-amd64 --config proxy-config.yaml &
curl -s http://127.0.0.1:1088/health
# {"data":{"status":"ok","tag":"v2.2.1","port":"1088", ... }}
```

也可以在开发机上用脚本自动下载（GitHub 直连不通时自动走 ghproxy.cc 镜像）：

```bash
node scripts/fetch-proxy-binary.js both     # 同时取 linux 与 windows 版
node scripts/fetch-proxy-binary.js linux    # 只取 linux 版
```

> 二进制名随便叫什么都行：项目按平台自动识别（Linux 认 `douyinLive-linux-amd64`），
> 也可用环境变量 `DOUYIN_PROXY_BIN=/opt/douyin-monitor/xxx` 指定。
> 若目录里只有别的平台构建，状态页会明确提示「不是当前平台的构建」。

**关于代理配置**：Go 代理的配置 schema 与 Node 端不同，它严格校验字段，
多一个 `dashboard` 段就会直接启动失败：

```
加载配置失败: 配置文件字段校验失败: line 26: field dashboard not found in type main.configFileSchema
```

因此项目会在根目录自动生成代理专用配置 `proxy-config.yaml`（已加入 .gitignore），
并把 Node 端 `config.yaml` 的 `cookie.douyin` 同步过去 —— **cookie 只需要配一处**。
手动启动代理时请带上 `--config proxy-config.yaml`。

### 1.2 抖音 cookie

`config.yaml` 里填 `cookie.douyin`（浏览器登录抖音网页版 → F12 → Application → Cookies，复制整串）。
监控脚本启动代理时会自动同步到 `proxy-config.yaml`。

---

## 2. 构建前端

```bash
cd frontend
npm install
npm run build      # 产物输出到 frontend/dist，由 web-dashboard.js 直接托管
cd ..
```

生产环境同样需要 `frontend/.env.production` 里的 `VITE_ACCESS_MODE = frontend`
（否则登录后会去请求后端不存在的菜单接口，跳到 500 页面）。

---

## 3. 配置

```bash
cp config.example.yaml config.yaml
# 编辑 config.yaml：填 cookie.douyin，设置 dashboard.token（对外访问务必设置）
```

监控房间列表（也可在仪表盘「房间管理」里增删，写入 `runtime-config.json`）：

```bash
cat > runtime-config.json <<'JSON'
{
  "rooms": [
    { "id": "房间号", "name": "主播名", "enabled": true }
  ],
  "check_interval_seconds": 30,
  "reconnect_delay_seconds": 10,
  "save_json": false,
  "feishu": {}
}
JSON
```

> 房间为空时守护进程会立刻退出，状态页会提示「未配置监控房间」。

---

## 4. 用 systemd 常驻（推荐）

仓库里已带两个单元文件：

```bash
sudo cp deploy/douyin-monitor.service /etc/systemd/system/
sudo cp deploy/douyin-dashboard.service /etc/systemd/system/

# 按实际路径/用户名改一下（WorkingDirectory、User、ExecStart 里的 node 路径）
sudo nano /etc/systemd/system/douyin-monitor.service

sudo systemctl daemon-reload
sudo systemctl enable --now douyin-monitor douyin-dashboard
```

查看状态与日志：

```bash
systemctl status douyin-monitor
journalctl -u douyin-monitor -f          # 实时日志
tail -f /opt/douyin-monitor/logs/daemon.log
```

> 注意：不要同时用 systemd 和 `node monitor.js --daemon` 手动启动，
> 会有两个进程抢同一个房间与数据库。手动启过就先 `node monitor.js stop`。

---

## 5. 不用 systemd 的简易方式

```bash
node monitor.js --daemon      # 启动守护进程
node web-dashboard.js &       # 启动仪表盘

node monitor.js status        # 查看状态
node monitor.js stop          # 停止守护进程
```

仓库自带的 `start.sh` 用的是 `nohup`，也能用，但没有崩溃自愈能力，生产建议 systemd。

---

## 6. 仪表盘访问与安全

默认只监听 `127.0.0.1:9871`，推荐前面挂 Nginx：

```nginx
location / {
    proxy_pass http://127.0.0.1:9871;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

**务必设置访问令牌**（`config.yaml` 的 `dashboard.token` 或环境变量 `DASHBOARD_TOKEN`）。
未设置时仪表盘任何人可访问，且会打警告日志。

默认账号 `admin` / `guest`，初始密码都是 `123456`，**上线前请改密码**
（`dashboard_users` 表存的是 sha256(password)）。

---

## 7. 在服务器上验证

```bash
# 代理是否在监听、健康检查是否通过
ss -lntp | grep 1088
curl -s http://127.0.0.1:1088/health

# 守护进程是否在跑
node monitor.js status

# 仪表盘接口
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9871/
```

状态页的判定口径：

- **Go 代理**：`GET http://127.0.0.1:1088/health` 返回 `status: ok`（顺带显示代理版本 tag）
  —— 比单纯探端口准，能区分「端口被别的程序占用」和「代理真的可用」
- **监控脚本**：`monitor.pid` 进程存活 **且** `monitor.sock` 能应答
  （受限环境下 socket 建不出来时显示「运行中，但控制通道不可用」）
- **WebSocket 连接**：守护进程回报的各房间连接状态汇总

健康的一屏应该是：

```
Go 抓取代理  :1088 · v2.2.1     正常
监控脚本     monitor.js         运行中  PID xxxx
WebSocket 连接  2 / 2           直播中 1 · 录制中 0
异常提示      未发现异常
```

---

## 8. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 状态页显示「未找到 Go 抓取代理」 | 二进制没放对位置或没执行权限；`chmod +x`，或用 `DOUYIN_PROXY_BIN` 指定 |
| 状态页显示「不是当前平台的构建」 | 下载错了平台包（如服务器上放了 windows 版），换成对应平台的 |
| 代理报 `field dashboard not found in configFileSchema` | 代理读到了 Node 端的 config.yaml；用 `--config proxy-config.yaml` 隔离（项目自动生成） |
| 代理报 `field proxy not found in configFileSchema` | 已发布二进制（v2.2.1）的 schema 还没有 `proxy` 段，而官方 config.example.yaml 已包含它（示例领先于发布版）；项目生成配置时已刻意不含该字段 |
| 状态页显示「config.yaml 未配置抖音 cookie」 | 填 `cookie.douyin` 后重启守护进程 |
| 守护进程启动后立刻退出 | 多半是没配房间（`runtime-config.json` 为空）或缺少上面的两样东西；`tail logs/daemon.log` 看具体报错 |
| `monitor.sock` 无法创建 | 目录权限问题，或运行在受限沙箱里；确保运行用户对项目目录有写权限 |
| 仪表盘 401 | 设置了 `dashboard.token`，URL 带 `?token=xxx` 或前端登录 |
| better-sqlite3 安装失败 | Node 版本低于 20，或缺少构建工具；优先用 Node 20/22 |

---

## 9. 平台说明

- 代理二进制名按平台自动识别：Linux → `douyinLive-linux-amd64`，
  Windows → `douyinLive-win-amd64.exe`，macOS → `douyinLive-darwin-amd64`；
  也可用环境变量 `DOUYIN_PROXY_BIN` 强制指定。
- 二进制与 `proxy-config.yaml` 均已加入 `.gitignore`，不会误提交（后者含 cookie）。
- 备份建议同时备份 `db/douyin.db`（WAL 模式下要连 `-wal`、`-shm` 一起，或先 checkpoint）。
