import { MatrixRain } from '@/components/shared/MatrixRain';
import { Navbar } from '@/components/landing/Navbar';
import { HeroSection } from '@/components/landing/HeroSection';
import { ProblemSection } from '@/components/landing/ProblemSection';
import { HowItWorksSection } from '@/components/landing/HowItWorksSection';
import { FeaturesSection } from '@/components/landing/FeaturesSection';
import { ArchitectureSection } from '@/components/landing/ArchitectureSection';
import { UseCasesSection } from '@/components/landing/UseCasesSection';
import { PricingSection } from '@/components/landing/PricingSection';
import { CTASection } from '@/components/landing/CTASection';
import { Footer } from '@/components/landing/Footer';

export default function Home() {
  return (
    <main className="relative min-h-screen bg-[#090600]">
      <MatrixRain />
      <Navbar />
      <HeroSection />
      <ProblemSection />
      <HowItWorksSection />
      <FeaturesSection />
      <ArchitectureSection />
      <UseCasesSection />
      <PricingSection />
      <CTASection />
      <Footer />
    </main>
  );
}
