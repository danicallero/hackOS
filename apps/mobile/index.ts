// Android Live Updates (#966): the headless notification task must be defined
// before Expo Router boots, so it lives in the entry file's module scope.
import "./lib/live-activities/background-task";
import "expo-router/entry";
