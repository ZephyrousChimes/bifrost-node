// Derived from ajna-frontend's Aurora/GodParticle components -- same violet-glow visual
// language (see globals.css's .aurora-backdrop for the actual gradient recipe), reduced to a
// single fixed backdrop element since a dashboard needs one settled decoration, not a
// multi-layer hero-reveal animation.
export default function AuroraBackdrop() {
  return <div aria-hidden className="aurora-backdrop" />;
}
