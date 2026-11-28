/**
 * @module web/app/page
 * @description Public marketing landing page (static, no data fetching): the
 * shared site navbar, hero with an animated call preview, activity ticker,
 * feature grid, meetings walkthrough, sketch-to-diagram, demo, bring-your-own-keys,
 * team essentials, FAQ, closing call to action and footer. Entry point for
 * logged-out visitors (`/`).
 *
 * @important Every product screenshot on this page is a decorative component
 *            built from markup (`aria-hidden`, sample content), not an image
 *            or live data.
 */
import ActivityTicker from "../components/landing/ActivityTicker";
import ByokSection from "../components/landing/ByokSection";
import CtaSection from "../components/landing/CtaSection";
import DemoSection from "../components/landing/DemoSection";
import FaqSection from "../components/landing/FaqSection";
import FeatureBento from "../components/landing/FeatureBento";
import HeroCallPreview from "../components/landing/HeroCallPreview";
import MeetingSteps from "../components/landing/MeetingSteps";
import { DemoCta, StartCta } from "../components/landing/parts";
import SiteFooter from "../components/landing/SiteFooter";
import SketchToDiagram from "../components/landing/SketchToDiagram";
import TeamsSection from "../components/landing/TeamsSection";
import SiteNavbar from "../components/SiteNavbar";

/** Renders the landing page. */
export default function LandingPage() {
  return (
    <main className="overflow-x-clip bg-(--background) font-sans text-(--foreground)">
      <div className="flex min-h-dvh flex-col bg-[linear-gradient(var(--grid-line)_1px,transparent_1px),linear-gradient(90deg,var(--grid-line)_1px,transparent_1px)] bg-size-[48px_48px]">
        <SiteNavbar />
        <section
          id="hero"
          className="mx-auto flex w-full max-w-7xl flex-1 flex-wrap content-center items-center gap-14 px-5 pt-6 pb-16 sm:px-10 sm:pb-18"
        >
          <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-7">
            <h1 className="font-display text-[clamp(42px,5.4vw,72px)] leading-[1.02] font-semibold tracking-[-0.035em]">
              The workspace that listens,
              <br />
              <span className="text-(--violet)">and remembers.</span>
            </h1>
            <p className="max-w-130 text-lg leading-relaxed text-(--text-body)">
              Live docs, whiteboards and chat for your team, with an assistant
              in every call. Captions in each person&apos;s language, notes
              with decisions and owners when you hang up, and answers the moment
              you ask out loud.
            </p>
            <div className="flex flex-wrap gap-3">
              <StartCta />
              <DemoCta />
            </div>
          </div>
          <HeroCallPreview />
        </section>
      </div>

      <ActivityTicker />

      <div className="mx-auto max-w-7xl px-5 sm:px-10">
        <FeatureBento />
        <MeetingSteps />
        <SketchToDiagram />
        <DemoSection />
        <ByokSection />
        <TeamsSection />
        <FaqSection />
        <CtaSection />
      </div>

      <SiteFooter />
    </main>
  );
}
