import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { Alert, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { StatusBar } from "expo-status-bar";
import Colors from "@/constants/colors";

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.bg },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="add" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      <Stack.Screen name="content/[id]" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  useEffect(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const onUnhandled = (ev: PromiseRejectionEvent) => {
        // Log and show a friendly alert for unhandled rejections in web preview
        // eslint-disable-next-line no-console
        console.error("Unhandled promise rejection:", ev.reason);
        try {
          Alert.alert?.("Error", String(ev.reason?.message || ev.reason || "Unknown error"));
        } catch {}
      };

      const onError = (event: ErrorEvent) => {
        // eslint-disable-next-line no-console
        console.error("Unhandled error:", event.error || event.message);
      };

      window.addEventListener("unhandledrejection", onUnhandled as any);
      window.addEventListener("error", onError as any);

      return () => {
        window.removeEventListener("unhandledrejection", onUnhandled as any);
        window.removeEventListener("error", onError as any);
      };
    }
  }, []);

  if (!fontsLoaded) return null;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <KeyboardProvider>
            <StatusBar style="light" />
            <RootLayoutNav />
          </KeyboardProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
