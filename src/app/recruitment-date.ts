function isValidParts(year: number, month: number, day: number): boolean {
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return false;
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  return day >= 1 && day <= daysInMonth;
}

export function isValidRecruitmentDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  return isValidParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function getRecruitmentDateErrors(input: {
  applicationStart: string;
  deadline: string;
  startDateConfirmed: boolean;
  dateConfirmed: boolean;
}): { applicationStart?: string; deadline?: string } {
  const errors: { applicationStart?: string; deadline?: string } = {};
  if (input.applicationStart && !isValidRecruitmentDate(input.applicationStart))
    errors.applicationStart = '올바른 지원 시작일을 입력해 주세요.';
  if (input.deadline && !isValidRecruitmentDate(input.deadline))
    errors.deadline = '올바른 마감일을 입력해 주세요.';
  if (input.startDateConfirmed && !input.applicationStart)
    errors.applicationStart =
      '시작일 확인을 체크하려면 날짜를 입력해야 합니다.';
  if (input.dateConfirmed && !input.deadline)
    errors.deadline = '마감일 확인을 체크하려면 날짜를 입력해야 합니다.';
  if (
    !errors.applicationStart &&
    !errors.deadline &&
    input.applicationStart &&
    input.deadline &&
    input.deadline < input.applicationStart
  )
    errors.deadline = '마감일은 지원 시작일보다 빠를 수 없습니다.';
  return errors;
}
