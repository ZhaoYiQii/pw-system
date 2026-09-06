import { Button, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import "./index.css";

export default function PlayerAvailabilityPage() {
  return (
    <View className="page">
      <Text className="title">接单时间</Text>
      <Text className="desc">维护本人不可接单时间段（重叠会被后端拒绝）。</Text>
      <View className="notice">
        <Text>
          移动端账号登录正在接入中。登录后本页将调用 /tenant/player/availability
          真实增删排期；当前以门店后台管理为准。
        </Text>
      </View>
      <Button
        className="btn"
        onClick={() => void Taro.reLaunch({ url: "/pages/index/index" })}
      >
        回首页
      </Button>
    </View>
  );
}
