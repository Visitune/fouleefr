import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'foulee_france_install_dismissed_at';
const DISMISS_DAYS = 14;

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Boolean(at) && Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

/**
 * Invite à installer l'application sur l'écran d'accueil.
 * - Android / Chrome : bouton qui déclenche l'installation native.
 * - iPhone / iPad : Safari n'a pas d'API d'installation, on affiche la marche à suivre.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(() => recentlyDismissed());
  const [installed, setInstalled] = useState(() => isStandalone());

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const ios = isIos();
  if (installed || hidden || (!deferred && !ios)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* stockage indisponible : la bannière réapparaîtra */
    }
    setHidden(true);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    if (choice.outcome === 'dismissed') dismiss();
  };

  return (
    <div
      role="region"
      aria-label="Installer l'application"
      className="md:hidden absolute top-2 inset-x-2 z-30 rounded-xl bg-slate-900 text-white shadow-xl px-3.5 py-3 flex items-start gap-3"
    >
      <div className="flex-1 min-w-0 text-sm leading-snug">
        <p className="font-semibold">Installer Foulée France</p>
        {deferred ? (
          <p className="text-slate-300 text-xs mt-0.5">
            Ajoutez l&apos;application à votre écran d&apos;accueil : plein écran, accès direct.
          </p>
        ) : (
          <p className="text-slate-300 text-xs mt-0.5">
            Touchez{' '}
            <Share className="inline w-3.5 h-3.5 -mt-0.5" aria-label="Partager" /> puis{' '}
            <strong className="text-white">« Sur l&apos;écran d&apos;accueil »</strong>.
          </p>
        )}
        {deferred && (
          <button
            type="button"
            onClick={() => void install()}
            className="mt-2 inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-lg bg-emerald-500 text-slate-950 text-sm font-semibold cursor-pointer active:scale-[0.98]"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            <span>Installer</span>
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Fermer, ne plus proposer pendant 14 jours"
        className="shrink-0 -mr-1 -mt-1 w-10 h-10 flex items-center justify-center rounded-lg text-slate-300 hover:text-white cursor-pointer"
      >
        <X className="w-5 h-5" aria-hidden="true" />
      </button>
    </div>
  );
}
