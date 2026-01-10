import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getColorByCount } from '@/utils/postGrouping';

interface TileMarkerProps {
  count: number;
  groupingFactor: number;
}

export function TileMarker({ count, groupingFactor }: TileMarkerProps) {
  // Marker size increases slightly with grouping
  const baseSize = 30 + Math.log2(groupingFactor) * 3;
  const countBonus = Math.min(count * 2, 20);
  const size = Math.min(baseSize + countBonus, 60);
  
  // Color by post count
  const color = getColorByCount(count);
  
  return (
    <View
      style={[
        styles.marker,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
      ]}
    >
      <Text style={styles.count}>{count}</Text>
      
      {/* Show scale indicator for grouped tiles */}
      {groupingFactor > 1 && (
        <Text style={styles.scale}>×{groupingFactor}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  marker: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  count: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  scale: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    color: 'white',
    fontSize: 8,
    fontWeight: 'bold',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 4,
  },
});
