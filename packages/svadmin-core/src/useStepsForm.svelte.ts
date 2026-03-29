import { useForm } from './form-hooks.svelte';
import type { UseFormOptions, UseFormReturn } from './form-hooks.svelte';
import type { BaseRecord, HttpError } from './types';

export interface UseStepsFormOptions<
  TVariables extends Record<string, unknown> = Record<string, unknown>,
  TData extends BaseRecord = BaseRecord,
  TError = HttpError,
> extends UseFormOptions<TVariables, TData, TError> {
  /** Default step index. Starts at 0. */
  defaultStep?: number;
  /** Validate the form when navigating back? */
  isBackValidate?: boolean;
}

export interface UseStepsFormReturn<
  TVariables extends Record<string, unknown> = Record<string, unknown>,
  TData extends BaseRecord = BaseRecord,
> extends UseFormReturn<TVariables, TData> {
  currentStep: number;
  gotoStep: (step: number) => void;
  next: () => void;
  prev: () => void;
}

/**
 * useStepsForm
 * Extends `useForm` with step navigation state (currentStep, next, prev, gotoStep).
 */
export function useStepsForm<
  TVariables extends Record<string, unknown> = Record<string, unknown>,
  TData extends BaseRecord = BaseRecord,
  TError = HttpError,
>(options: UseStepsFormOptions<TVariables, TData, TError> = {} as UseStepsFormOptions<TVariables, TData, TError>): UseStepsFormReturn<TVariables, TData> {
  const form = useForm<TVariables, TData, TError>(options);

  let currentStep = $state(options.defaultStep ?? 0);

  function gotoStep(step: number) {
    currentStep = Math.max(0, step);
  }

  function next() {
    gotoStep(currentStep + 1);
  }

  function prev() {
    if (currentStep > 0) {
      gotoStep(currentStep - 1);
    }
  }

  // Inject stepping features into the returned useForm object while preserving its reactive getters.
  const result = form as unknown as UseStepsFormReturn<TVariables, TData>;

  Object.defineProperty(result, 'currentStep', {
    get: () => currentStep,
    enumerable: true,
    configurable: true
  });

  result.gotoStep = gotoStep;
  result.next = next;
  result.prev = prev;

  return result;
}
