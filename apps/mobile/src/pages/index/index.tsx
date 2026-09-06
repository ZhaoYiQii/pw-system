import { Text, View } from "@tarojs/components";
import { runtimeInfo } from "@platform-runtime";
import "./index.css";

export default function Index() {
  return (
    <View className="index">
      <Text>runtime={runtimeInfo.kind}</Text>
      <Text>adapter={runtimeInfo.label}</Text>
    </View>
  );
}
