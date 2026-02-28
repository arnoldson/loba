import { Tabs } from "expo-router"
import { Text, View, StyleSheet } from "react-native"

function TabIcon({
  label,
  emoji,
  focused,
}: {
  label: string
  emoji: string
  focused: boolean
}) {
  return (
    <View style={styles.tabIcon}>
      <Text style={[styles.emoji, focused && styles.emojiFocused]}>
        {emoji}
      </Text>
      <Text style={[styles.label, focused && styles.labelFocused]}>
        {label}
      </Text>
    </View>
  )
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#fff",
          borderTopColor: "#e0e0e0",
          height: 85,
          paddingTop: 8,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Map" emoji="🗺️" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="my-posts"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon label="My Posts" emoji="📝" focused={focused} />
          ),
        }}
      />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  tabIcon: {
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: {
    fontSize: 22,
    opacity: 0.5,
  },
  emojiFocused: {
    opacity: 1,
  },
  label: {
    fontSize: 11,
    color: "#999",
    marginTop: 2,
  },
  labelFocused: {
    color: "#007AFF",
    fontWeight: "600",
  },
})
