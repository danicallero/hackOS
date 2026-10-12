"use client";

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { GithubLogoIcon } from "@phosphor-icons/react/dist/csr/GithubLogo";
import { GlobeIcon } from "@phosphor-icons/react/dist/csr/Globe";
import { InstagramLogoIcon } from "@phosphor-icons/react/dist/csr/InstagramLogo";
import { LinkedinLogoIcon } from "@phosphor-icons/react/dist/csr/LinkedinLogo";
import { LinkSimpleIcon } from "@phosphor-icons/react/dist/csr/LinkSimple";
import { XLogoIcon } from "@phosphor-icons/react/dist/csr/XLogo";
import { SOCIAL_LABEL, type SocialKind, type SocialLink, socialLinkText } from "@/lib/directory";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const SOCIAL_ICON: Record<SocialKind, PhosphorIcon> = {
  linkedin: LinkedinLogoIcon,
  github: GithubLogoIcon,
  x: XLogoIcon,
  instagram: InstagramLogoIcon,
  website: GlobeIcon,
  other: LinkSimpleIcon,
};

/**
 * A person's public links (#935). The address stays visible next to the
 * icon, so readers can see where a link goes before following it.
 */
export function SocialLinks({ links, className }: { links: SocialLink[]; className?: string }) {
  const { t } = useLocale();
  if (links.length === 0) return null;
  return (
    <ul aria-label={t("publicProfileLinks")} className={cn("space-y-1.5", className)}>
      {links.map((link) => {
        const Icon = SOCIAL_ICON[link.kind];
        return (
          <li key={link.url} className="min-w-0">
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              className="inline-flex max-w-full items-center gap-2 text-sm underline-offset-4 hover:underline"
            >
              <Icon aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
              <span className="sr-only">{t(SOCIAL_LABEL[link.kind])}: </span>
              <span className="min-w-0 truncate">{socialLinkText(link.url)}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
