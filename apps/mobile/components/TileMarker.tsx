import { View, Text, StyleSheet } from "react-native";

interface TileMarkerProps {
  count: number;
  groupingFactor?: number | null;
}

export function TileMarker({ count, groupingFactor }: TileMarkerProps) {
  // Determine color based on post count
  const getColor = () => {
    if (count === 1) return "#4CAF50"; // Green - single post
    if (count <= 5) return "#2196F3"; // Blue - few posts
    if (count <= 10) return "#FFC107"; // Yellow - medium
    if (count <= 20) return "#FF9800"; // Orange - many
    return "#F44336"; // Red - very many
  };

  const color = getColor();

  return (
    <View style={styles.container}>
      {/* Main circular marker */}
      <View style={[styles.marker, { backgroundColor: color }]}>
        <Text style={styles.count}>{count}</Text>
      </View>

      {/* No grouping factor label - removed for end users */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
  },
  marker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "white",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  count: {
    color: "white",
    fontSize: 14,
    fontWeight: "bold",
  },
});
