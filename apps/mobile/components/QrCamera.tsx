import { CameraView, useCameraPermissions } from "expo-camera";
import { Button, StyleSheet, Text, View } from "react-native";

export function QrCamera({
  onValue,
  onClose,
}: {
  onValue: (value: string) => void;
  onClose: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <View style={styles.permission}>
        <Text>Camera permission is required to scan QR codes.</Text>
        <Button title="Allow camera" onPress={() => void requestPermission()} />
        <Button title="Close" onPress={onClose} />
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => onValue(data)}
      />
      <Button title="Close camera" onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 8 },
  camera: { width: "100%", aspectRatio: 1 },
  permission: { gap: 8, padding: 16 },
});
