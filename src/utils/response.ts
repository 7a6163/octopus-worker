/**
 * 回應工具函數
 */

/**
 * 成功回應
 */
export function success<T>(data: T) {
  return {
    code: 0,
    message: 'success',
    data,
  };
}

/**
 * 錯誤回應
 */
export function error(message: string, code: number = -1) {
  return {
    code,
    message,
    data: null,
  };
}

/**
 * OpenAI 格式錯誤回應
 */
export function openaiError(message: string, type: string = 'invalid_request_error') {
  return {
    error: {
      message,
      type,
    },
  };
}
