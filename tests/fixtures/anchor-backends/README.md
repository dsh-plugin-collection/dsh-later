# 面板锚定后端的分代导出摘录（issue #158）

两份 `primitives-<代次>-exports.txt` 是 registry 上
`@deepseek-ai/dsh-client-ui-primitives` 发布包 `lib/types/index.d.ts` 里
**锚定相关导出行的原样摘录**，不是手抄的形状。复核方式见
`docs/verification.md` 的 #158 一节。

```sh
cd /tmp && rm -rf p && mkdir p && cd p
npm pack @deepseek-ai/dsh-client-ui-primitives@0.2.2-rc.1 && tar xzf *.tgz
grep -E '^export .*(useAnchoredPosition|useAnchoredMaxHeight|usePointerGrace)' \
  package/lib/types/index.d.ts
```

结论：`0.2.2-rc.1` 有 `useAnchoredPosition`；`0.2.2-rc.2` 没有，替代面是
`useAnchoredMaxHeight`（只算高度）与 `usePointerGrace`（指针离开的关闭延迟），
定位改由 CSS 锚点定位承担。
