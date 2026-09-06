import { Button, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import "./index.css";

export default function PlayerProfilePage() {
  return (
    <View className="page">
      <Text className="title">我的陪玩资料</Text>
      <Text className="desc">
        这里将展示并维护陪玩本人档案、技能与接单状态。
      </Text>
      <View className="notice">
        <Text>
          移动端账号登录正在接入中（后端已具备「绑定账号 + /tenant/player/me」自助接口）。
          当前请先在门店后台管理资料；登录切片完成后本页将读取真实数据，不展示模拟成功。
        </Text>
      </View>
      <Button className="btn" onClick={() => void Taro.reLaunch({ url: "/pages/index/index" })}>
        回首页
      </Button>
    </View>
  );
}