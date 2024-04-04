import { StyleSheet } from "react-native";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

import EditScreenInfo from "@/components/EditScreenInfo";
import { Text, View } from "@/components/Themed";

export default function TabOneScreen() {
  let tasks = useQuery(api.tasks.get);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Tab 1</Text>
      {tasks?.map(({ _id, text }) => <Text key={_id}>{text}</Text>)}
      <View
        style={styles.separator}
        lightColor="#eee"
        darkColor="rgba(255,255,255,0.1)"
      />
      <EditScreenInfo path="app/(tabs)/index.tsx" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
  },
  separator: {
    marginVertical: 30,
    height: 1,
    width: "80%",
  },
});
