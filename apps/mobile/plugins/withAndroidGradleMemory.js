const { withGradleProperties } = require("expo/config-plugins");

// The Expo template caps the Gradle daemon at -Xmx2048m and 512m Metaspace.
// Release builds run lintVitalAnalyzeRelease for every autolinked library in
// parallel and exhaust that Metaspace ("OutOfMemoryError: Metaspace"), so
// raise both limits.
const JVM_ARGS = "-Xmx4096m -XX:MaxMetaspaceSize=1536m -XX:+HeapDumpOnOutOfMemoryError";

function withAndroidGradleMemory(config) {
  return withGradleProperties(config, (config) => {
    const props = config.modResults.filter(
      (item) => !(item.type === "property" && item.key === "org.gradle.jvmargs"),
    );
    props.push({ type: "property", key: "org.gradle.jvmargs", value: JVM_ARGS });
    config.modResults = props;
    return config;
  });
}

module.exports = withAndroidGradleMemory;
