桌面 2 x 版
没注册的朋友欢迎走邀请链接  https://app.getgrass.io/register/?referralCode=2o5K2BpLUfWrXTV
首先安装 screen（如果还没安装）：
apt-get update && apt-get install screen -y
创建新的 screen 会话：
screen -S grass
暂时离开会话：按 Ctrl + A，然后按 D
重新连接会话：screen -r grass
查看所有会话：screen -ls
结束会话：在会话中输入 exit 或按 Ctrl + A，然后按 K
在 screen 会话中运行程序

安装 nodejs npm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && nvm install --lts && nvm use --lts
检测是否成功
node -v
npm -v
git clone https://github.com/xmrjun/grass-node.git
cd grass-node
安装所需依赖项：
npm install
使用说明
获取用户 ID：
登录到 ：https://app.getgrass.io/register/?referralCode=2o5K2BpLUfWrXTV
打开浏览器开发者工具（通常按 F12 或右键选择“检查”）。
切换到“控制台”选项卡。
输入以下命令并按回车：
localStorage.getItem('userId');
复制返回的值，这就是你的用户 ID。
把 uid.txt 改成自己的id
proxy.txt 放自己的代理

启动机器人：

在终端中执行以下命令运行 npm start
