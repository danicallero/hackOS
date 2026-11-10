import { Suspense } from "react";
import { PageLayout } from "@/components/common/page-layout";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

export default function OnboardingPage() {
  return (
    <PageLayout width="reading">
      <Suspense fallback={null}>
        <OnboardingFlow />
      </Suspense>
    </PageLayout>
  );
}
