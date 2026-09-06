import type { PropsWithChildren } from "react";
import { useLaunch } from "@tarojs/taro";
import "./app.css";

function App({ children }: PropsWithChildren) {
  useLaunch(() => {
    console.log("[pw-mobile] app launched (Slice 0)");
  });

  return children ?? null;
}

export default App;
