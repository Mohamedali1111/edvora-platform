import type { CreateQuestionOptionRequest, CreateQuestionRequest, CreateQuizRequest, UpdateQuestionOptionRequest, UpdateQuestionRequest, UpdateQuizRequest } from "@/lib/api/types";

export type DecimalFieldError = "required" | "invalid" | "tooSmall" | "tooLarge";
export type TextFieldError = "required" | "tooLong";

const DECIMAL_PATTERN = /^\d+(?:\.\d{1,2})?$/;

export function parseDecimalInput(value: string, constraints: { required: boolean; min: number; max?: number }): { value?: number; error?: DecimalFieldError } {
  const trimmed = value.trim();

  if (!trimmed) {
    return constraints.required ? { error: "required" } : {};
  }

  if (!DECIMAL_PATTERN.test(trimmed)) {
    return { error: "invalid" };
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed)) {
    return { error: "invalid" };
  }

  if (parsed < constraints.min) {
    return { error: "tooSmall" };
  }

  if (constraints.max !== undefined && parsed > constraints.max) {
    return { error: "tooLarge" };
  }

  return { value: parsed };
}

export function parseOptionalIntegerInput(value: string): { value?: number | null; error?: "invalid" | "tooSmall" } {
  const trimmed = value.trim();

  if (!trimmed) {
    return { value: null };
  }

  if (!/^\d+$/.test(trimmed)) {
    return { error: "invalid" };
  }

  const parsed = Number(trimmed);

  if (!Number.isSafeInteger(parsed)) {
    return { error: "invalid" };
  }

  if (parsed < 1) {
    return { error: "tooSmall" };
  }

  return { value: parsed };
}

export type QuizFormErrors = {
  title?: TextFieldError;
  description?: "tooLong";
  passingScorePercent?: DecimalFieldError;
  attemptLimit?: "invalid" | "tooSmall";
};

export function buildQuizCreatePayload(input: {
  title: string;
  description: string;
  passingScorePercent: string;
  attemptLimit: string;
  revealAnswersPolicy: CreateQuizRequest["revealAnswersPolicy"];
}): { payload?: CreateQuizRequest; errors: QuizFormErrors } {
  const errors: QuizFormErrors = {};
  const title = input.title.trim();
  const description = input.description.trim();
  const passing = parseDecimalInput(input.passingScorePercent, { required: false, min: 0, max: 100 });
  const attemptLimit = parseOptionalIntegerInput(input.attemptLimit);

  if (!title) {
    errors.title = "required";
  } else if (title.length > 240) {
    errors.title = "tooLong";
  }

  if (description.length > 5000) {
    errors.description = "tooLong";
  }

  if (passing.error) {
    errors.passingScorePercent = passing.error;
  }

  if (attemptLimit.error) {
    errors.attemptLimit = attemptLimit.error;
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    errors,
    payload: {
      title,
      description: description || null,
      passingScorePercent: passing.value ?? null,
      attemptLimit: attemptLimit.value ?? null,
      revealAnswersPolicy: input.revealAnswersPolicy,
    },
  };
}

export function buildQuizUpdatePayload(input: Parameters<typeof buildQuizCreatePayload>[0]): { payload?: UpdateQuizRequest; errors: QuizFormErrors } {
  return buildQuizCreatePayload(input);
}

export function buildQuestionCreatePayload(input: { type: CreateQuestionRequest["type"]; prompt: string; points: string }): {
  payload?: CreateQuestionRequest;
  errors: { prompt?: TextFieldError; points?: DecimalFieldError };
} {
  const errors: { prompt?: TextFieldError; points?: DecimalFieldError } = {};
  const prompt = input.prompt.trim();
  const points = parseDecimalInput(input.points, { required: true, min: Number.MIN_VALUE });

  if (!prompt) {
    errors.prompt = "required";
  } else if (prompt.length > 5000) {
    errors.prompt = "tooLong";
  }

  if (points.error) {
    errors.points = points.error === "tooSmall" ? "invalid" : points.error;
  }

  if (Object.keys(errors).length > 0 || points.value === undefined || points.value <= 0) {
    return { errors: { ...errors, points: errors.points ?? (points.value !== undefined && points.value <= 0 ? "tooSmall" : undefined) } };
  }

  return { errors, payload: { type: input.type, prompt, points: points.value } };
}

export function buildQuestionUpdatePayload(input: { prompt: string; points: string }): {
  payload?: UpdateQuestionRequest;
  errors: { prompt?: TextFieldError; points?: DecimalFieldError };
} {
  const result = buildQuestionCreatePayload({ type: "MULTIPLE_CHOICE", prompt: input.prompt, points: input.points });
  return result.payload ? { errors: result.errors, payload: { prompt: result.payload.prompt, points: result.payload.points } } : { errors: result.errors };
}

export function buildOptionCreatePayload(input: { label: string; text: string; isCorrect: boolean }): {
  payload?: CreateQuestionOptionRequest;
  errors: { label?: "tooLong"; text?: TextFieldError };
} {
  const errors: { label?: "tooLong"; text?: TextFieldError } = {};
  const label = input.label.trim();
  const text = input.text.trim();

  if (label.length > 40) {
    errors.label = "tooLong";
  }

  if (!text) {
    errors.text = "required";
  } else if (text.length > 5000) {
    errors.text = "tooLong";
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return { errors, payload: { label: label || null, text, isCorrect: input.isCorrect } };
}

export function buildOptionUpdatePayload(input: { label: string; text: string }): {
  payload?: UpdateQuestionOptionRequest;
  errors: { label?: "tooLong"; text?: TextFieldError };
} {
  const result = buildOptionCreatePayload({ ...input, isCorrect: false });
  return result.payload ? { errors: result.errors, payload: { label: result.payload.label, text: result.payload.text } } : { errors: result.errors };
}
