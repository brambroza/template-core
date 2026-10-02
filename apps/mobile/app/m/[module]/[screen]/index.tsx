import { useLocalSearchParams } from 'expo-router';
import { ModuleScreen } from '../../../../src/components/ModuleScreen';

export default function ScreenRoute() {
  const p = useLocalSearchParams<{ module: string; screen: string }>();
  return <ModuleScreen module={p.module} screen={p.screen} />;
}
