
function authenticateUser(username, password) {
  const user = findUser(username);
  if (!user) throw new Error('User not found');
  const isValid = verifyPassword(password, user.hash);
  if (!isValid) throw new Error('Invalid password');
  return generateToken(user);
}

class AuthService {
  constructor(db) { this.db = db; }
  async login(username, password) {
    const user = await this.db.findUser(username);
    if (!user) throw new AuthError('Invalid credentials');
    return this.createSession(user);
  }
}

function handleError(err) {
  console.error('Error occurred:', err.message);
  if (err instanceof AuthError) return { status: 401, message: 'Unauthorized' };
  return { status: 500, message: 'Internal server error' };
}

function validateToken(token) {
  try {
    const decoded = jwt.verify(token, SECRET);
    return decoded;
  } catch (e) {
    throw new Error('Token validation failed');
  }
}
