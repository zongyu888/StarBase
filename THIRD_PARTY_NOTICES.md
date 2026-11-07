# 第三方声明

## Another Redis Desktop Manager

Navideck 的 Redis 工作台在键树分组交互与算法上参考并改写了
[Another Redis Desktop Manager](https://github.com/qishibo/AnotherRedisDesktopManager)
的部分实现（`src/util.js` 中的 `keysToTree` / `formatTreeData` 思路），改写为
React/TypeScript（`frontend/src/lib/redisTree.ts`）和 Go 后端实现；界面按 Navideck
的样式体系重新设计，并扩展了 INFO 仪表盘、类型化条目编辑、TTL/重命名、批量删除和 CLI。

原项目版权与许可证如下：

```
The MIT License (MIT)

Copyright (c) shibo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
## chroma-gui

Navideck 的 Chroma 工作台在功能设计上参考了
[chroma-gui](https://github.com/sqalongl/chroma-gui)（集合浏览、文档 CRUD、向量搜索、
元数据过滤、HNSW 集合详情、分页浏览），并按 Navideck 的 Go API 与 React 组件体系重写，
未直接嵌入其静态资源或代理服务。原项目 README 声明使用 MIT License，版权归原作者所有。

原项目功能说明：

> 一个简洁美观的 Chroma 向量数据库可视化管理工具，帮助开发者在开发调试阶段快速查看和管理向量数据库中的数据。

```
MIT License

Copyright (c) sqalongl/chroma-gui contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
