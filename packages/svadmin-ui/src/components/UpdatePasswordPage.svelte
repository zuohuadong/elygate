<script lang="ts">
  import { useUpdatePassword } from '@svadmin/core';
  import { t } from '@svadmin/core/i18n';
  import { navigate } from '@svadmin/core/router';
  import { Button } from './ui/button/index.js';
  import * as Card from './ui/card/index.js';
  import * as Alert from './ui/alert/index.js';
  import PasswordInput from './PasswordInput.svelte';
  import { ShieldCheck, Loader2, AlertCircle } from 'lucide-svelte';

  let { title = 'Admin' } = $props<{
    title?: string;
  }>();

  const updatePw = useUpdatePassword();

  let password = $state('');
  let confirmPassword = $state('');
  let error = $state('');

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    error = '';

    if (!password) { error = t('auth.passwordRequired'); return; }
    if (password !== confirmPassword) { error = t('auth.passwordMismatch'); return; }

    const result = await updatePw.mutate({ password, confirmPassword });
    if (!result.success) {
      error = result.error?.message ?? t('common.operationFailed');
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-background p-4">
  <div class="w-full max-w-[380px]">
    <Card.Card>
      <Card.CardHeader class="text-center pb-2">
        <div class="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 text-primary mx-auto mb-3">
          <ShieldCheck class="h-5 w-5" />
        </div>
        <Card.CardTitle class="text-xl">{t('auth.resetPassword')}</Card.CardTitle>
        <p class="text-sm text-muted-foreground">{t('auth.resetPasswordDescription')}</p>
      </Card.CardHeader>
      <Card.CardContent>
        <form onsubmit={handleSubmit} class="space-y-4">
          {#if error}
            <Alert.Root variant="destructive">
              <AlertCircle class="h-4 w-4" />
              <Alert.Description>{error}</Alert.Description>
            </Alert.Root>
          {/if}

          <PasswordInput
            id="new-password"
            label={t('auth.password')}
            bind:value={password}
            autocomplete="new-password"
            showStrength
          />

          <PasswordInput
            id="confirm-password"
            label={t('auth.confirmPassword')}
            bind:value={confirmPassword}
            autocomplete="new-password"
          />

          <Button type="submit" class="w-full" disabled={updatePw.isLoading}>
            {#if updatePw.isLoading}
              <Loader2 class="h-4 w-4 animate-spin mr-2" />
            {/if}
            {t('auth.resetPassword')}
          </Button>

          <div class="flex items-center justify-center mt-2">
            <Button variant="link" class="text-sm h-auto p-0 font-medium" onclick={() => navigate('/login')}>
              {t('auth.backToLogin')}
            </Button>
          </div>
        </form>
      </Card.CardContent>
    </Card.Card>

    <p class="text-xs text-muted-foreground mt-4 text-center opacity-60">
      Powered by {title}
    </p>
  </div>
</div>
