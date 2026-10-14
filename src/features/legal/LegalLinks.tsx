import { legalReleasePacket, type AssetRegister, type LegalFacts } from './release';
export function LegalLinks({ facts = null, assets }: { facts?: LegalFacts | null; assets?: AssetRegister }) {
  const packet = legalReleasePacket(facts, assets);
  return <section aria-label="Legal information">
    {packet.links ? <nav aria-label="Policies and support">
      <a href={packet.links.privacy} rel="noopener noreferrer">Privacy policy</a>{' '}
      <a href={packet.links.terms} rel="noopener noreferrer">Terms of use</a>{' '}
      <a href={packet.links.support} rel="noopener noreferrer">Support</a>
    </nav> : <p role="status">Legal information is not available yet.</p>}
  </section>;
}
