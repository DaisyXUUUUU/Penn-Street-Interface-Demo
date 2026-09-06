# Smart Bus Stop Demo

一个面向 iPad 竖屏公交站牌的交互式网页原型。项目以 SEPTA 风格的站牌信息为视觉参考，重点演示多路线切换、车辆到站进度、倒计时状态和到站提醒。

> 这是设计展示用 demo。路线、站点、到站时间和终点信息均为示例数据，不应用于真实出行决策。

## 运行

这是一个无需安装依赖的静态网页项目。

直接在浏览器打开 `index.html`，或在项目根目录启动本地服务器：

```bash
python3 -m http.server 4173
```

然后访问 [http://127.0.0.1:4173](http://127.0.0.1:4173)。

## 当前交互

- iPad 竖屏布局，包含顶部 SEPTA 信息栏、路线信息卡和底部 Stop ID。
- 中央路线卡显示当前路线、前一站、本站、途经站、终点和两辆车的等待时间。
- 点击底部左右箭头可切换示例路线；两侧露出的卡片边缘提示还有相邻路线。
- 第一辆车会沿进度线由左向右驶向 `YOUR STOP`，并和倒计时同步。
- 演示时间倍率：现实世界 1 秒 = 界面倒计时 10 秒。
- 第一班车等待时间会改变整个到站卡配色：
  - 超过 5 分钟：浅绿色
  - 1–5 分钟：浅橙色
  - 少于 1 分钟：浅红色
- 车辆进入最后 1 分钟时出现橙色提醒；进入最后 10 秒时出现红色提醒。提醒覆盖中间路线区域 5 秒，不遮挡上下信息栏。

## 文件结构

```text
.
├── index.html                 # 页面结构
├── styles.css                 # 响应式视觉样式与动画
├── script.js                  # 路线数据、倒计时、路线切换和提醒逻辑
├── assets/
│   ├── header-strip-cropped.png  # 用户提供的顶部信息栏素材
│   ├── footer-strip-cropped.png  # 用户提供的底部信息栏素材
│   └── bus-front.png             # 用户提供的车辆图标素材
└── deliverables/              # 设计过程中的故事板图
```

## 修改示例路线数据

所有 demo 路线集中在 `script.js` 的 `routes` 数组中。每条路线可配置路线号、站点、终点、两辆车到站秒数等：

```js
{
  number: '124',
  previous: 'Girard Ave & 33rd St',
  current: '69th Street Transportation Center',
  stops: [['Market St & 69th St', '1 stop away']],
  final: 'Girard Ave & 5th St',
  detail: '(Temple University)',
  first: 120,
  second: 720
}
```

后续接入真实服务时，只需用 API 返回的数据替代这个数组，并按实际车辆位置或预测到站时间更新 `first`、`second` 和车辆进度。
