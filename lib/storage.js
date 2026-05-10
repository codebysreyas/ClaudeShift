export async function getProfiles() {
  const result = await chrome.storage.local.get('profiles');
  return result.profiles || [];
}

export async function setProfiles(profiles) {
  await chrome.storage.local.set({ profiles });
}

export async function getActiveProfileName() {
  const result = await chrome.storage.local.get('activeProfile');
  return result.activeProfile || null;
}

export async function setActiveProfileName(name) {
  await chrome.storage.local.set({ activeProfile: name });
}

export async function clearActiveProfile() {
  await chrome.storage.local.remove('activeProfile');
}

export async function getProfileByName(name) {
  const profiles = await getProfiles();
  return profiles.find(p => p.name === name) || null;
}

export async function upsertProfile(profile) {
  const profiles = await getProfiles();
  const index = profiles.findIndex(p => p.name === profile.name);
  if (index !== -1) {
    profiles[index] = profile;
  } else {
    profiles.push(profile);
  }
  await setProfiles(profiles);
}

export async function deleteProfileByName(name) {
  const profiles = await getProfiles();
  await setProfiles(profiles.filter(p => p.name !== name));
}

export async function renameProfile(oldName, newName) {
  const profiles = await getProfiles();
  const index = profiles.findIndex(p => p.name === oldName);
  if (index === -1) throw new Error('Profile not found');
  const nameExists = profiles.some(p => p.name === newName);
  if (nameExists) throw new Error('A profile with that name already exists');
  profiles[index] = { ...profiles[index], name: newName };
  await setProfiles(profiles);
  const active = await getActiveProfileName();
  if (active === oldName) await setActiveProfileName(newName);
}

export async function duplicateProfile(name) {
  const profiles = await getProfiles();
  const source = profiles.find(p => p.name === name);
  if (!source) throw new Error('Profile not found');
  let newName = `${name} (copy)`;
  let counter = 2;
  while (profiles.some(p => p.name === newName)) {
    newName = `${name} (copy ${counter++})`;
  }
  const copy = {
    ...source,
    name: newName,
    createdAt: new Date().toISOString(),
    lastUsed: null,
    lastVerified: null,
    expired: false
  };
  profiles.push(copy);
  await setProfiles(profiles);
  return copy;
}
