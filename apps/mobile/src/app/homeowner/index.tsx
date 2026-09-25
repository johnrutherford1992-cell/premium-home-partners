import { Redirect } from 'expo-router';
import { BlankField } from '../../components/RoleGate';
import { ErrorState } from '../../components/States';
import { useMyHome } from '../../data/homeowner';
import { useMode } from '../../lib/mode';
import { useApp } from '../../store/app';
import { Screen } from '../../ui/controls';

export default function HomeownerEntry() {
  const { mode } = useMode();
  return mode === 'live' ? <LiveEntry /> : <DemoEntry />;
}

function DemoEntry() {
  const onboarded = useApp((s) => s.step >= 6);
  return <Redirect href={onboarded ? '/homeowner/home' : '/homeowner/onboarding'} />;
}

/** Live: onboarded homeowners land on Home, everyone else on onboarding. */
function LiveEntry() {
  const my = useMyHome();
  if (my.data) return <Redirect href={my.data.onboarded ? '/homeowner/home' : '/homeowner/onboarding'} />;
  if (my.error) {
    return (
      <Screen>
        <ErrorState title="We couldn't load your home" message={my.error} onRetry={my.refetch} />
      </Screen>
    );
  }
  return <BlankField />;
}
