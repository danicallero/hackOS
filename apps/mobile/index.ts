// Live Activities (#966): the background notification task (Android Live
// Updates, iOS push-triggered refresh) must be defined before Expo Router
// boots, so it lives in the entry file's module scope.
import "./lib/live-activities/background-task";
import "expo-router/entry";
