import { Redirect } from 'expo-router';
import { useApp } from '../../store/app';

export default function HomeownerEntry() {
  const onboarded = useApp((s) => s.step >= 6);
  return <Redirect href={onboarded ? '/homeowner/home' : '/homeowner/onboarding'} />;
}
