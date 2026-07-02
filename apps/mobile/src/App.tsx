import React, { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { createIdentity, loadIdentity, type Identity } from './identity';
import type { GroupRef } from './groupStore';
import { GroupListScreen } from './screens/GroupListScreen';
import { GroupScreen } from './screens/GroupScreen';
import { colors, styles } from './theme';
import { Pressable } from 'react-native';

type Route = { name: 'groups' } | { name: 'group'; ref: GroupRef };

export default function App() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState<Route>({ name: 'groups' });

  useEffect(() => {
    loadIdentity()
      .then(setIdentity)
      .finally(() => setLoading(false));
  }, []);

  let body: React.ReactNode;
  if (loading) {
    body = (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  } else if (!identity) {
    body = <Onboarding onDone={setIdentity} />;
  } else if (route.name === 'group') {
    body = (
      <GroupScreen
        groupRef={route.ref}
        identity={identity}
        onBack={() => setRoute({ name: 'groups' })}
      />
    );
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

  return (
    <View style={[styles.container, { flex: 1, justifyContent: 'center' }]}>
      <Text style={styles.title}>Splts</Text>
      <Text style={styles.subtitle}>
        Split expenses without a company in the middle. Your data lives on your
        device and syncs directly with your group.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Your name (shown to your groups)"
        placeholderTextColor={colors.muted}
        value={name}
        onChangeText={setName}
        autoFocus
      />
      <Pressable
        style={[styles.button, !name.trim() && { opacity: 0.5 }]}
        disabled={!name.trim()}
        onPress={() => createIdentity(name).then(onDone)}
      >
        <Text style={styles.buttonText}>Get started</Text>
      </Pressable>
    </View>
  );
}
