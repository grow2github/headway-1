import { defaults } from 'lodash'
const JwtStrategy = require('passport-jwt').Strategy,
  ExtractJwt = require('passport-jwt').ExtractJwt

import * as bcrypt from 'bcrypt'
import * as passport from 'passport'
const LocalStrategy = require('passport-local').Strategy

import Admin from './models/Admin'
import Student from './models/Student'
import Mentor from './models/Mentor'
import Course from './models/Course'
import { Business, Card } from './models'
import { SALT_ROUNDS, JWT_ISSUER } from './constants'

passport.use('admin-local', new LocalStrategy({ usernameField: 'email' }, (email, password, done) => {
  authenticateAdmin(email, password).then(result => {
    done(null, result)
  }).catch(err => {
    done(err)
  })
}))

passport.use('mentor-local', new LocalStrategy({ usernameField: 'email' }, (email, password, done) => {
  authenticateMentor(email, password).then(result => {
    done(null, result)
  }).catch(err => {
    done(err)
  })
}))

passport.use('student-local', new LocalStrategy({ usernameField: 'email' }, (email, password, done) => {
  authenticateStudent(email, password).then(result => {
    done(null, result)
  }).catch(err => {
    done(err)
  })
}))

passport.use('jwt', new JwtStrategy({
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET,
  issuer: JWT_ISSUER,
  audience: 'invite',
}, (jwt_payload, done) => {
  const { sub, userType } = jwt_payload
  if (userType === 'admin') {
    Admin.findByPk(sub).then(admin => {
      if (admin) {
        return done(null, admin)
      } else {
        return done(null, false)
      }
    })
  } else {
    Student.findByPk(sub).then(student => {
      if (student) {
        return done(null, student)
      } else {
        return done(null, false)
      }
    })
  }
}))

passport.serializeUser((entity, done) => {
  const type = entity.userType
  return done(null, {
    id: entity.id,
    type,
  })
})

passport.deserializeUser((key, done) => {
  const { id, type } = key
  if (type === 'admin') {
    Admin.findByPk(id).then(admin => {
      done(null, { admin })
    })
  } else if (type === 'mentor') {
    Mentor.findByPk(id).then(mentor => {
      done(null, { mentor })
    })
  } else {
    Student.findByPk(id).then(student => {
      done(null, { student })
    })
  }
})

export const authAdmin = passport.authenticate('admin-local', {
  // successReturnToOrRedirect: true,
  failureRedirect: '/l/creator'
})

export const authStudent = passport.authenticate('student-local', {
  failureRedirect: '/l/member'
})

export const authStudentInvite = passport.authenticate('jwt', {
  failureRedirect: '/l/member'
})

export const authAdminInvite = passport.authenticate('jwt', {
  failureRedirect: '/l/creator'
})

export const authMentor = passport.authenticate('mentor-local', {
  failureRedirect: '/l/mentor'
})

export const checkAdminLogin = (req, res, next) => {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user.admin) {
    return res.redirect('/l/creator')
  }
  next()
}

export const mockAdminLogin = (req, res, next) => {
  req.isAuthenticated = () => true // =\
  req.user = {
    admin: {
      id: 2
    }
  }
  next()
}

export const mockStudentLogin = (req, res, next) => {
  req.isAuthenticated = () => true // =\
  req.user = {
    student: {
      id: 1
    }
  }
  next()
}

export const checkStudentLogin = (req, res, next) => {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user.student) {
    return res.redirect('/l/member')
  }
  next()
}

export const checkMentorLogin = (req, res, next) => {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user.mentor) {
    return res.redirect('/l/mentor')
  }
  next()
}

export const checkStudentEnrolled = (req, res, next) => {
  const { courseId } = req.params
  if (!req.user) {
    return res.status(401).send({ message: 'Unauthorized' })
  }
  Student.findByPk(req.user.student.id, { include: [Course] }).then(student => {
    const ids = student.courses.map(course => course.id)
    if (ids.indexOf(parseInt(courseId)) === -1) {
      return res.status(401).send({ message: 'Unauthorized' })
    }
    next()
  })
}

export const checkAdminPermission = (req, res, next) => {
  const { courseId, businessId, studentId, cardId } = defaults(req.body, req.params)
  if (!req.user) {
    return res.status(401).send({ message: 'Unauthorized' })
  }
  Admin.findByPk(req.user.admin.id, {
    include: [
      Course,
      {
        model: Business,
        include: [Student]
      },
    ]
  }).then(admin => {
    if (cardId) {
      Card.scope('includeCourse').findByPk(cardId).then(card => {
        if (card && card.unit.course.adminId === admin.id) {
          next()
        } else {
          return res.status(401).send({ message: 'Unauthorized: Admin does not own Card' })
        }
      })
      return
    }
    if (courseId) {
      const courseIds = admin.courses.map(course => course.id)
      if (courseIds.indexOf(parseInt(courseId)) === -1) {
        return res.status(401).send({ message: 'Unauthorized: Admin does not own Course' })
      }
    }
    if (businessId) {
      const businessIds = admin.businesses.map(business => business.id)
      if (businessIds.indexOf(parseInt(businessId)) === -1) {
        return res.status(401).send({ message: 'Unauthorized: Admin does not own Business' })
      }
    }
    if (studentId) {
      const studentIds = admin.businesses.reduce((previousValue, currentValue) => {
        const ids = currentValue.students.map(student => student.id)
        return previousValue.concat(ids)
      }, [])
      if (studentIds.indexOf(parseInt(studentId)) === -1) {
        return res.status(401).send({ message: 'Unauthorized: Admin does not own Student' })
      } else {
        next()
      }
    } else {
      next()
    }
  })
}

export const authEpilogue = (req, res, context) => {
  return new Promise((resolve, reject) => {
    if (!req.isAuthenticated || !req.isAuthenticated() || !req.user.admin) {
      res.status(401).send({ message: 'Unauthorized' })
      resolve(context.stop)
    } else {
      resolve(context.continue)
    }
  })
}

// authenticateEntity authenticates an admin, student or mentor.
//
// It stores a new hash if their existing hash was generated with a lower number
// of salt rounds that the current configuration requires.
//
// It returns an object representing the entity, or false on a failure, as per
// the requirements of the "local" Passport strategy.
const authenticateEntity = async (entity: Admin | Student | Mentor, password: string): Promise<object | boolean> => {
  const result = await verifyPassword(password, entity.password)

  if (!result.verified) {
    return false
  }

  if (result.newHash) {
    entity.password = result.newHash
    await entity.save()
  }

  return entity.toJSON()
}

// authenticateAdmin authenticates an admin using their email address and
// password as credentials.
const authenticateAdmin = async (email: string, password: string) : Promise<object | boolean> => {
  const admin = await Admin.findOne({ where: { email } })
  if (!admin) {
    return false
  }

  return authenticateEntity(admin, password)
}

// authenticateStudent authenticates an student using their email address and
// password as credentials.
const authenticateStudent = async (email: string, password: string) : Promise<object | boolean> => {
  const student = await Student.findOne({ where: { email } })
  if (!student) {
    return false
  }

  const result = await authenticateEntity(student, password)
  if (!result) {
    return false
  }

  student.lastLoggedIn = new Date()
  await student.save().then(savedStudent => {
    console.log(savedStudent)
  })

  return result
}

// authenticateMentor authenticates an mentor using their email address and
// password as credentials.
const authenticateMentor = async (email: string, password: string) : Promise<object | boolean> => {
  const mentor = await Mentor.findOne({ where: { email } })
  if (!mentor) {
    return false
  }

  return authenticateEntity(mentor, password)
}

// hashPassword returns the hash of the given password.
export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(SALT_ROUNDS)
  return await bcrypt.hash(password, salt)
}

// hashPasswordSync is a synchronous version of hashPassword
export const hashPasswordSync = (password: string): string => {
  const salt = bcrypt.genSaltSync(SALT_ROUNDS)
  return bcrypt.hashSync(password, salt)
}

export interface PasswordVerificationResult {
  verified: boolean
  newHash?: string
}

// verifyPassword attempts to verify a password, and provides a new hash if the
// existing hash no longer uses an adequate numner of salt rounds.
export const verifyPassword = async (plaintext: string, hash: string): Promise<PasswordVerificationResult> => {
  const verified = await bcrypt.compare(plaintext, hash)

  if (verified && bcrypt.getRounds(hash) < SALT_ROUNDS) {
    const newHash = await hashPassword(plaintext)
    return { verified, newHash }
  }

  return { verified }
}
