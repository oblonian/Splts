import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { createIdentity, loadIdentity, type Identity } from './identity';
import type { GroupRef } from './groupStore';
import { GroupListScreen } from './screens/GroupListScreen';
import { GroupScreen } from './screens/GroupScreen';
import { colors, styles } from './theme';
import { Banner, Field, PrimaryButton } from './ui';
import { useBackHandler } from './useBackHandler';

type Route = { name: 'groups' } | { name: 'group'; ref: GroupRef };

export default function App() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading');
  const [route, setRoute] = useState<Route>({ name: 'groups' });

  const boot = useCallback(() => {
    setPhase('loading');
    loadIdentity()
      .then((id) => {
        setIdentity(id);
        setPhase('ready');
      })
      // Do NOT fall through to onboarding on a read failure: creating a
      // "new" identity would orphan every balance keyed to the old id.
      .catch(() => setPhase('error'));
  }, []);

  useEffect(boot, [boot]);

  const goToGroups = useCallback(() => setRoute({ name: 'groups' }), []);
  useBackHandler(route.name === 'group', goToGroups);

  let body: React.ReactNode;
  if (phase === 'loading') {
    body = (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  } else if (phase === 'error') {
    body = (
      <View style={[styles.container, { flex: 1, justifyContent: 'center' }]}>
        <Banner text="Couldn't read your saved profile from device storage." />
        <PrimaryButton label="Try again" onPress={boot} />
      </View>
    );
  } else if (!identity) {
    body = <Onboarding onDone={setIdentity} />;
  } else if (route.name === 'group') {
    body = <GroupScreen groupRef={route.ref} identity={identity} onBack={goToGroups} />;
  } else {
    body = (
      <GroupListScreen
        identity={identity}
        onOpenGroup={(ref) => setRoute({ name: 'group', ref })}
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      {body}
    </SafeAreaView>
  );
}

function Onboarding({ onDone }: { onDone: (identity: Identity) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(false);

  return (
    <View style={[styles.container, { flex: 1, justifyContent: 'center' }]}>
      <Text style={styles.title}>Splts</Text>
      <Text style={styles.subtitle}>
        Split expenses without a company in the middle. Your data lives on your
        device and syncs directly with your group.
      </Text>
      {error && <Banner text="Couldn't save your profile. Check device storage and try again." />}
      <Field
        placeholder="Your name (shown to your groups)"
        value={name}
        onChangeText={setName}
        autoFocus
      />
      <PrimaryButton
        label="Get started"
        disabled={!name.trim()}
        onPress={() =>
          createIdentity(name)
            .then(onDone)
            .catch(() => setError(true))
        }
      />
    </View>
  );
}
