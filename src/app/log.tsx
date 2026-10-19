// Log การสื่อสารกับตัวเสียบ (ไว้หาปัญหา)
import { useRef, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { elm, logLines, logStore } from '../core/engine';
import { useStore } from '../core/store';
import { Toggle } from '../ui/kit';
import { t as tr } from '../i18n';
import { useTheme } from '../ui/theme';

export default function Log() {
  const t = useTheme();
  useStore(logStore);
  const [verbose, setVerbose] = useState(elm.verbose);
  const ref = useRef<ScrollView>(null);
  return (
    <ScrollView ref={ref} style={{backgroundColor: t.bg}} contentContainerStyle={{padding: 14}}
      onContentSizeChange={() => ref.current?.scrollToEnd({animated: false})}>
      <Toggle label={tr('log.verbose')} value={verbose} onChange={v => { elm.verbose = v; setVerbose(v); }} />
      <Text selectable style={{color: t.mut, fontFamily: 'monospace', fontSize: 11, marginTop: 8}}>
        {logLines.join('\n') || tr('none')}
      </Text>
    </ScrollView>
  );
}
