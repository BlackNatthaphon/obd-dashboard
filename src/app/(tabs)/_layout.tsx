import { Tabs } from 'expo-router';
import { t as tr, type Key } from '../../i18n';
import { TabIcon, TopBar } from '../../ui/TopBar';
import { useTheme } from '../../ui/theme';

const TABS: [string, Key, Key][] = [
  ['index', 'tab.dash', 'title.dash'],
  ['race', 'tab.race', 'tab.race'],
  ['live', 'tab.live', 'tab.live'],
  ['graph', 'tab.graph', 'tab.graph'],
  ['diag', 'tab.diag', 'tab.diag'],
];

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: t.acc,
      tabBarInactiveTintColor: t.mut,
      tabBarStyle: {backgroundColor: t.card, borderTopColor: t.line},
      sceneStyle: {backgroundColor: t.bg},
      tabBarLabelStyle: {fontSize: 11, lineHeight: 16},
    }}>
      {TABS.map(([name, label, title]) => (
        <Tabs.Screen key={name} name={name} options={{
          title: tr(label),
          header: () => <TopBar title={tr(title)} />,
          tabBarIcon: ({color}) => <TabIcon name={name} color={String(color)} />,
        }} />
      ))}
    </Tabs>
  );
}
